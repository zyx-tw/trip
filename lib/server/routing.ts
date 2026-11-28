import { country } from "../countries"
import { daysOf } from "../dates"
import type { Leg, Place, Ride, TripWithPlaces } from "../types"
import { db } from "./db"

// Routes between consecutive places of a day. Walks come from the FOSSGIS OSRM
// foot server, transit from Transitous. Both are free community services that
// ask for at most 1 request a second and a User-Agent that names the app, so
// every answer is cached and requests to each host go out one at a time.

const USER_AGENT =
  "trip.zyx.tw (personal trip planner; https://github.com/zyx-tw/trip)"
/** Farther than this in a straight line, a leg is planned by transit. */
export const WALK_LIMIT_M = 1500
const WALK_TTL = 30 * 86_400_000
// Timetables change a few times a year; a week keeps legs fast without going stale.
const TRANSIT_TTL = 7 * 86_400_000

const g = globalThis as unknown as {
  tripQueues?: Map<string, Promise<unknown>>
  tripLoading?: Map<string, Promise<unknown>>
}
const queues = (g.tripQueues ??= new Map())
/** Answers still on their way, so a page and the background warm-up ask once. */
const loading = (g.tripLoading ??= new Map())

/** Runs `job` after the previous request to the same host, at least 1.1 s apart. */
function paced<T>(host: string, job: () => Promise<T>): Promise<T> {
  const previous = queues.get(host) ?? Promise.resolve()
  const next = previous.then(job, job)
  queues.set(
    host,
    next.then(
      () => new Promise((r) => setTimeout(r, 1100)),
      () => new Promise((r) => setTimeout(r, 1100))
    )
  )
  return next
}

async function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<T | null>
): Promise<T | null> {
  const row = db()
    .prepare("select body, created_at from route_cache where key = ?")
    .get(key) as { body: string; created_at: number } | undefined
  if (row && Date.now() - row.created_at < ttl) return JSON.parse(row.body) as T
  const pending = loading.get(key) as Promise<T | null> | undefined
  if (pending) return pending
  const job = load()
    .then((value) => {
      if (value !== null)
        db()
          .prepare(
            "insert or replace into route_cache (key, body, created_at) values (?, ?, ?)"
          )
          .run(key, JSON.stringify(value), Date.now())
      return value
    })
    .finally(() => loading.delete(key))
  loading.set(key, job)
  return job
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  return res.json()
}

/** Straight-line distance in meters. */
export function meters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) {
  const rad = Math.PI / 180
  const x =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lng - a.lng) * rad) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(x))
}

const at = (p: { lat: number; lng: number }) =>
  `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`

type Walk = { minutes: number; meters: number; line: [number, number][] }

export function walk(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<Walk | null> {
  return cached(`walk:${at(a)};${at(b)}`, WALK_TTL, () =>
    paced("osrm", async () => {
      const body = (await getJson(
        `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${at(a)};${at(b)}?overview=full&geometries=geojson`
      )) as {
        code: string
        routes?: {
          distance: number
          duration: number
          geometry: { coordinates: [number, number][] }
        }[]
      }
      const route = body.code === "Ok" ? body.routes?.[0] : undefined
      if (!route) return null
      return {
        minutes: Math.max(1, Math.round(route.duration / 60)),
        meters: Math.round(route.distance),
        line: route.geometry.coordinates,
      }
    })
  )
}

type TransitLeg = {
  mode: string
  routeColor?: string
  legGeometry?: { points: string; precision: number }
  duration: number
  startTime: string
  endTime: string
  displayName?: string
  routeShortName?: string
  headsign?: string
  from: { name: string }
  to: { name: string }
}
type Itinerary = {
  duration: number
  startTime: string
  endTime: string
  transfers: number
  legs: TransitLeg[]
}

export type Plan = {
  minutes: number
  departs: string
  arrives: string
  transfers: number
  rides: Ride[]
}

/** HH:MM of an ISO time in a time zone. */
function clock(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso))
}

/** The UTC offset of a time zone on a day, as +09:00. */
function offset(day: string, timeZone: string) {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(new Date(`${day}T12:00:00Z`))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT"
  return name === "GMT" ? "+00:00" : name.slice(3)
}

/**
 * Transit itineraries from a to b on a day. With arriveBy the trips arrive by
 * `time`; otherwise they leave from `time` on.
 */
export async function planTransit(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  opts: {
    day: string
    time: string
    arriveBy: boolean
    timeZone: string
    count?: number
  }
): Promise<Plan[]> {
  const when = `${opts.day}T${opts.time}:00${offset(opts.day, opts.timeZone)}`
  const count = opts.count ?? 3
  const key = `transit:${at(a)};${at(b)};${when};${opts.arriveBy ? "by" : "from"};${count}`
  const plans = await cached(key, TRANSIT_TTL, () =>
    paced("transitous", async () => {
      const url = new URL("https://api.transitous.org/api/v5/plan")
      url.searchParams.set("fromPlace", `${a.lat},${a.lng}`)
      url.searchParams.set("toPlace", `${b.lat},${b.lng}`)
      url.searchParams.set("time", when)
      url.searchParams.set("arriveBy", String(opts.arriveBy))
      url.searchParams.set("numItineraries", String(count))
      const body = (await getJson(url.href)) as { itineraries?: Itinerary[] }
      return (body.itineraries ?? []).slice(0, count).map((it) => ({
        minutes: Math.round(it.duration / 60),
        departs: clock(it.startTime, opts.timeZone),
        arrives: clock(it.endTime, opts.timeZone),
        transfers: it.transfers,
        rides: it.legs
          .filter((l) => l.mode !== "WALK")
          .map((l) => ({
            name: l.displayName || l.routeShortName || l.mode,
            from: l.from.name,
            to: l.to.name,
            departs: clock(l.startTime, opts.timeZone),
            arrives: clock(l.endTime, opts.timeZone),
            headsign: l.headsign ?? "",
          })),
      }))
    })
  )
  return plans ?? []
}

type Stop = { place: Place; role: "start" | "stop" | "end" }

/**
 * When transit from a to b leaves or arrives: by b's time when b is a planned
 * stop, else from a's time when a is one, else in the morning out of the stay
 * or in the evening back to it.
 */
function timing(a: Stop, b: Stop) {
  if (b.role === "stop" && b.place.time)
    return { time: b.place.time, arriveBy: true }
  if (a.role === "stop" && a.place.time)
    return { time: a.place.time, arriveBy: false }
  return { time: a.role === "start" ? "10:00" : "18:00", arriveBy: false }
}

/**
 * The stops of a day in order: the stay slept in the night before, the
 * day's places, then the stay slept in that night. A stay is a place with
 * \`until\`: its day is check-in, \`until\` is check-out.
 */
export function dayStops(trip: TripWithPlaces, day: string): Stop[] {
  const stays = trip.places.filter((p) => p.day && p.until)
  const before = stays.find((s) => s.day! < day && s.until! >= day)
  const tonight = stays.find((s) => s.day! <= day && s.until! > day)
  const stops: Stop[] = [
    ...(before ? [{ place: before, role: "start" as const }] : []),
    ...trip.places
      .filter((p) => p.day === day)
      .sort((a, b) => a.position - b.position)
      .map((place) => ({ place, role: "stop" as const })),
    ...(tonight ? [{ place: tonight, role: "end" as const }] : []),
  ]
  // A stay that is also the day's first or last place appears once.
  return stops.filter((s, i) => i === 0 || stops[i - 1].place.id !== s.place.id)
}

/** The legs between the stops of every day. A leg that fails is left out. */
export async function tripLegs(trip: TripWithPlaces): Promise<Leg[]> {
  const timeZone = country(trip.country).timeZone
  const legs: Leg[] = []
  for (const day of daysOf(trip.startDate, trip.endDate)) {
    const stops = dayStops(trip, day)
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]
      const b = stops[i]
      try {
        if (meters(a.place, b.place) <= WALK_LIMIT_M) {
          const w = await walk(a.place, b.place)
          if (w)
            legs.push({
              day,
              from: a.place.id,
              to: b.place.id,
              mode: "walk",
              ...w,
            })
        } else {
          const [plan] = await planTransit(a.place, b.place, {
            day,
            timeZone,
            ...timing(a, b),
            count: 1,
          })
          if (plan)
            legs.push({
              day,
              from: a.place.id,
              to: b.place.id,
              mode: "transit",
              minutes: plan.minutes,
              meters: Math.round(meters(a.place, b.place)),
              rides: plan.rides,
            })
        }
      } catch {
        // The community server is down or slow; the page shows the places without this leg.
      }
    }
  }
  return legs
}

/** The points of an encoded polyline, as [lng, lat]. */
export function decodePolyline(points: string, precision: number): [number, number][] {
  const scale = 10 ** precision
  const line: [number, number][] = []
  let lat = 0
  let lng = 0
  let i = 0
  const next = () => {
    let shift = 0
    let value = 0
    let byte: number
    do {
      byte = points.charCodeAt(i++) - 63
      value |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && i < points.length)
    return value & 1 ? ~(value >> 1) : value >> 1
  }
  while (i < points.length) {
    lat += next()
    lng += next()
    line.push([lng / scale, lat / scale])
  }
  return line
}

/** One part of a route on the map: a walk, or a ride with its line's color. */
export type Segment = {
  mode: string
  /** The ride's name, empty for a walk. */
  name: string
  /** #rrggbb, empty when the timetable gives none. */
  color: string
  from: string
  to: string
  departs: string
  arrives: string
  line: [number, number][]
}

export type Route =
  | { mode: "walk"; minutes: number; meters: number; line: [number, number][] }
  | { mode: "transit"; minutes: number; departs: string; arrives: string; transfers: number; segments: Segment[] }

/**
 * How to get from a to b leaving at a time: a walk when it is short, else the
 * first transit trip with the path of every part, for drawing on a map.
 */
export async function routeBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  opts: { day: string; time: string; timeZone: string }
): Promise<Route | null> {
  if (meters(a, b) <= WALK_LIMIT_M) {
    const w = await walk(a, b)
    return w ? { mode: "walk", ...w } : null
  }
  const when = `${opts.day}T${opts.time}:00${offset(opts.day, opts.timeZone)}`
  return cached(`route:${at(a)};${at(b)};${when}`, TRANSIT_TTL, () =>
    paced("transitous", async () => {
      const url = new URL("https://api.transitous.org/api/v5/plan")
      url.searchParams.set("fromPlace", `${a.lat},${a.lng}`)
      url.searchParams.set("toPlace", `${b.lat},${b.lng}`)
      url.searchParams.set("time", when)
      url.searchParams.set("numItineraries", "1")
      const body = (await getJson(url.href)) as { itineraries?: Itinerary[] }
      const it = body.itineraries?.[0]
      if (!it) return null
      return {
        mode: "transit" as const,
        minutes: Math.round(it.duration / 60),
        departs: clock(it.startTime, opts.timeZone),
        arrives: clock(it.endTime, opts.timeZone),
        transfers: it.transfers,
        segments: it.legs.map((l) => ({
          mode: l.mode,
          name: l.mode === "WALK" ? "" : l.displayName || l.routeShortName || l.mode,
          color: l.routeColor ? `#${l.routeColor}` : "",
          from: l.from.name,
          to: l.to.name,
          departs: clock(l.startTime, opts.timeZone),
          arrives: clock(l.endTime, opts.timeZone),
          line: l.legGeometry ? decodePolyline(l.legGeometry.points, l.legGeometry.precision) : [],
        })),
      }
    })
  )
}

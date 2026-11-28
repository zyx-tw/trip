import { country } from "../countries"
import { daysOf } from "../dates"
import type { Leg, Place, Ride, TripWithPlaces } from "../types"
import { type Alert, alertFor } from "./alerts"
import { db } from "./db"

// Routes between consecutive places of a day. Walks come from the FOSSGIS OSRM
// foot server, transit from Transitous. Both are free community services that
// ask for at most 1 request a second and a User-Agent that names the app, so
// every answer is cached and requests to each host go out one at a time.

const USER_AGENT =
  "trip.zyx.tw (personal trip planner; https://github.com/zyx-tw/trip)"
/** Farther than this in a straight line, a leg is planned by transit. */
export const WALK_LIMIT_M = 1500
/** How many jobs a host may have queued before /api/route answers busy. */
const ROUTE_QUEUE_MAX = 4
const WALK_TTL = 30 * 86_400_000
// Timetables change a few times a year; a week keeps legs fast without going stale.
const TRANSIT_TTL = 7 * 86_400_000
const MAX_TTL = Math.max(WALK_TTL, TRANSIT_TTL)
/** The most routes the cache keeps. */
const CACHE_ROWS = 20_000
/** A walk offered when no transit runs, only up to this far. */
const WALK_FALLBACK_M = 5000

const g = globalThis as unknown as {
  tripQueues?: Map<string, Promise<unknown>>
  tripLoading?: Map<string, Promise<unknown>>
}
const queues = (g.tripQueues ??= new Map())
/** Answers still on their way, so a page and the background warm-up ask once. */
const loading = (g.tripLoading ??= new Map())

/** Runs `job` after the previous request to the same host, at least 1.1 s apart. */
/** Jobs waiting or running per host, so callers that can wait less can back off. */
const waiting = new Map<string, number>()

/** Thrown when a host already has a few jobs queued and the caller should try later. */
export class Busy extends Error {}

function paced<T>(host: string, job: () => Promise<T>): Promise<T> {
  const previous = queues.get(host) ?? Promise.resolve()
  waiting.set(host, (waiting.get(host) ?? 0) + 1)
  const done = () => waiting.set(host, (waiting.get(host) ?? 1) - 1)
  const next = previous.then(job, job).finally(done)
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
      if (value !== null) {
        db()
          .prepare(
            "insert or replace into route_cache (key, body, created_at) values (?, ?, ?)"
          )
          .run(key, JSON.stringify(value), Date.now())
        // Expired rows are never read again; drop them so the cache cannot grow without end.
        db().prepare("delete from route_cache where created_at < ?").run(Date.now() - MAX_TTL)
        // And keep at most CACHE_ROWS, newest first, so a busy caller cannot fill the disk.
        db()
          .prepare("delete from route_cache where key not in (select key from route_cache order by created_at desc limit ?)")
          .run(CACHE_ROWS)
      }
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
  routeId?: string
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
  /** The ride's line status now, such as a delay; null when all is normal or unknown. */
  alert: Alert | null
}

/** One way to ride there. */
export type Trip = { minutes: number; departs: string; arrives: string; transfers: number; segments: Segment[] }

export type Route =
  | { mode: "walk"; minutes: number; meters: number; line: [number, number][] }
  /** The first trip's fields, then every trip found, the first one included. */
  | ({ mode: "transit"; trips: Trip[] } & Trip)

/** How many trips a route offers. */
const TRIPS = 5

/**
 * How to get from a to b leaving at a time: a walk when it is short, else the
 * first transit trip with the path of every part, for drawing on a map.
 */
export async function routeBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  opts: { day: string; time: string; timeZone: string }
): Promise<Route | null> {
  // The same 6 decimals in the cache key and in the request, so keys never alias.
  const round = (p: { lat: number; lng: number }) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) })
  a = round(a)
  b = round(b)
  const asWalk = async () => {
    const w = await walk(a, b)
    return w ? { mode: "walk" as const, ...w } : null
  }
  // Trip pages and MCP share these queues; a map client waits at most a few jobs.
  const busy = (host: string) => {
    if ((waiting.get(host) ?? 0) >= ROUTE_QUEUE_MAX) throw new Busy(`${host} is busy`)
  }
  if (meters(a, b) <= WALK_LIMIT_M) {
    busy("osrm")
    return asWalk()
  }
  const when = `${opts.day}T${opts.time}:00${offset(opts.day, opts.timeZone)}`
  // Without alerts: they change by the minute and are added after the cache.
  const trips = await cached(`trips:${at(a)};${at(b)};${when};${TRIPS}`, TRANSIT_TTL, () => {
    // Only a fetch waits in the queue; a cached or in-flight route never gets busy.
    busy("transitous")
    return paced("transitous", async () => {
      const url = new URL("https://api.transitous.org/api/v5/plan")
      url.searchParams.set("fromPlace", `${a.lat},${a.lng}`)
      url.searchParams.set("toPlace", `${b.lat},${b.lng}`)
      url.searchParams.set("time", when)
      url.searchParams.set("numItineraries", String(TRIPS))
      const body = (await getJson(url.href)) as { itineraries?: Itinerary[] }
      const found = (body.itineraries ?? []).slice(0, TRIPS).map((it) => ({
        minutes: Math.round(it.duration / 60),
        departs: clock(it.startTime, opts.timeZone),
        arrives: clock(it.endTime, opts.timeZone),
        transfers: it.transfers,
        segments: it.legs.map((l) => ({
          mode: l.mode,
          routeId: l.routeId ?? "",
          name: l.mode === "WALK" ? "" : l.displayName || l.routeShortName || l.mode,
          color: l.routeColor ? `#${l.routeColor}` : "",
          from: l.from.name,
          to: l.to.name,
          departs: clock(l.startTime, opts.timeZone),
          arrives: clock(l.endTime, opts.timeZone),
          line: l.legGeometry ? decodePolyline(l.legGeometry.points, l.legGeometry.precision) : [],
        })),
      }))
      return found.length ? found : null
    })
  })
  const transit = trips && (await withAlerts(trips))
  if (transit) return { mode: "transit", ...transit[0], trips: transit }
  // Transitous drops transit slower than walking, so no trip can still mean a walk.
  if (meters(a, b) > WALK_FALLBACK_M) return null
  busy("osrm")
  return asWalk()
}

type CachedTrip = Omit<Trip, "segments"> & { segments: (Omit<Segment, "alert"> & { routeId: string })[] }

/** Adds each ride's line status now, and drops the route ids the client has no use for. */
async function withAlerts(trips: CachedTrip[]): Promise<Trip[]> {
  return Promise.all(
    trips.map(async (t) => ({
      ...t,
      segments: await Promise.all(t.segments.map(async ({ routeId, ...s }) => ({ ...s, alert: await alertFor(routeId) }))),
    }))
  )
}

/** One train or bus leaving a station. */
export type Departure = {
  /** HH:MM, the expected time when the timetable has live data, else the planned one. */
  time: string
  /** HH:MM as planned. */
  planned: string
  /** Minutes late from live data; null when there is none. */
  delay: number | null
  mode: string
  /** The line's short name, such as JY or のぞみ3号. */
  line: string
  /** #rrggbb, empty when the timetable gives none. */
  color: string
  headsign: string
  /** The platform, empty when unknown. */
  track: string
  alert: Alert | null
}

type StopTime = {
  place: { name: string; departure?: string; scheduledDeparture?: string; track?: string }
  mode: string
  realTime: boolean
  headsign: string
  routeId?: string
  routeColor?: string
  routeShortName?: string
  displayName?: string
  cancelled?: boolean
}

/** How long a station's departures are reused. */
const DEPARTURES_TTL = 60_000
/** How far from the station's marker its platforms may be. */
const STATION_RADIUS_M = 300
/** How many departures one station shows. */
const DEPARTURES = 40

/**
 * The next departures from the station named `name` at `p`. Platforms of other
 * stations nearby are left out by name, unless no platform carries the name.
 */
export async function departuresFrom(p: { lat: number; lng: number }, name: string, timeZone: string): Promise<Departure[]> {
  p = { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }
  const minute = Math.floor(Date.now() / 60_000)
  const rows = await cached(`departures:${at(p)};${name};${minute}`, DEPARTURES_TTL, () => {
    if ((waiting.get("transitous") ?? 0) >= ROUTE_QUEUE_MAX) throw new Busy("transitous is busy")
    return paced("transitous", async () => {
      const url = new URL("https://api.transitous.org/api/v5/stoptimes")
      url.searchParams.set("center", `${p.lat},${p.lng}`)
      url.searchParams.set("radius", String(STATION_RADIUS_M))
      url.searchParams.set("n", String(DEPARTURES * 2))
      const body = (await getJson(url.href)) as { stopTimes?: StopTime[] }
      return body.stopTimes ?? []
    })
  })
  const all = (rows ?? []).filter((s) => !s.cancelled && s.place.departure)
  const named = all.filter((s) => s.place.name === name || s.place.name.startsWith(`${name} `))
  const seen = new Set<string>()
  const out: Departure[] = []
  for (const s of named.length ? named : all) {
    const line = s.displayName || s.routeShortName || s.mode
    // Two feeds can carry the same train.
    const key = `${s.place.departure}|${line}|${s.headsign}`
    if (seen.has(key)) continue
    seen.add(key)
    const planned = s.place.scheduledDeparture ?? s.place.departure!
    out.push({
      time: clock(s.place.departure!, timeZone),
      planned: clock(planned, timeZone),
      delay: s.realTime ? Math.round((Date.parse(s.place.departure!) - Date.parse(planned)) / 60_000) : null,
      mode: s.mode,
      line,
      color: s.routeColor ? `#${s.routeColor}` : "",
      headsign: s.headsign,
      track: s.place.track ?? "",
      alert: await alertFor(s.routeId),
    })
    if (out.length === DEPARTURES) break
  }
  return out
}

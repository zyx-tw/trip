import { country } from "../countries"
import type { Leg, Place, Ride, TripWithPlaces } from "../types"
import { db } from "./db"

// Routes between consecutive places of a day. Walks come from the FOSSGIS OSRM
// foot server, transit from Transitous. Both are free community services that
// ask for at most 1 request a second and a User-Agent that names the app, so
// every answer is cached and requests to each host go out one at a time.

const USER_AGENT = "trip.zyx.tw (personal trip planner; https://github.com/zyx1121/trip)"
/** Farther than this in a straight line, a leg is planned by transit. */
export const WALK_LIMIT_M = 1500
const WALK_TTL = 30 * 86_400_000
// Timetables change a few times a year; a week keeps legs fast without going stale.
const TRANSIT_TTL = 7 * 86_400_000

const g = globalThis as unknown as { tripQueues?: Map<string, Promise<unknown>>; tripLoading?: Map<string, Promise<unknown>> }
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
      () => new Promise((r) => setTimeout(r, 1100)),
    ),
  )
  return next
}

async function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const row = db().prepare("select body, created_at from route_cache where key = ?").get(key) as { body: string; created_at: number } | undefined
  if (row && Date.now() - row.created_at < ttl) return JSON.parse(row.body) as T
  const pending = loading.get(key) as Promise<T | null> | undefined
  if (pending) return pending
  const job = load()
    .then((value) => {
      if (value !== null) db().prepare("insert or replace into route_cache (key, body, created_at) values (?, ?, ?)").run(key, JSON.stringify(value), Date.now())
      return value
    })
    .finally(() => loading.delete(key))
  loading.set(key, job)
  return job
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  return res.json()
}

/** Straight-line distance in meters. */
export function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180
  const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(x))
}

const at = (p: { lat: number; lng: number }) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`

type Walk = { minutes: number; meters: number; line: [number, number][] }

export function walk(a: Place, b: Place): Promise<Walk | null> {
  return cached(`walk:${at(a)};${at(b)}`, WALK_TTL, () =>
    paced("osrm", async () => {
      const body = (await getJson(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${at(a)};${at(b)}?overview=full&geometries=geojson`)) as {
        code: string
        routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[]
      }
      const route = body.code === "Ok" ? body.routes?.[0] : undefined
      if (!route) return null
      return { minutes: Math.max(1, Math.round(route.duration / 60)), meters: Math.round(route.distance), line: route.geometry.coordinates }
    }),
  )
}

type TransitLeg = { mode: string; duration: number; startTime: string; endTime: string; displayName?: string; routeShortName?: string; headsign?: string; from: { name: string }; to: { name: string } }
type Itinerary = { duration: number; startTime: string; endTime: string; transfers: number; legs: TransitLeg[] }

export type Plan = { minutes: number; departs: string; arrives: string; transfers: number; rides: Ride[] }

/** HH:MM of an ISO time in a time zone. */
function clock(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))
}

/** The UTC offset of a time zone on a day, as +09:00. */
function offset(day: string, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(`${day}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value ?? "GMT"
  return name === "GMT" ? "+00:00" : name.slice(3)
}

/**
 * Transit itineraries from a to b on a day. With arriveBy the trips arrive by
 * `time`; otherwise they leave from `time` on.
 */
export async function planTransit(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  opts: { day: string; time: string; arriveBy: boolean; timeZone: string; count?: number },
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
    }),
  )
  return plans ?? []
}

/** When transit to `b` leaves or arrives: by b's time, else from a's time, else 10:00. */
function timing(a: Place, b: Place) {
  if (b.time) return { time: b.time, arriveBy: true }
  if (a.time) return { time: a.time, arriveBy: false }
  return { time: "10:00", arriveBy: false }
}

/** The legs between consecutive places of every day. A leg that fails is left out. */
export async function tripLegs(trip: TripWithPlaces): Promise<Leg[]> {
  const timeZone = country(trip.country).timeZone
  const byDay = new Map<string, Place[]>()
  for (const p of trip.places) if (p.day) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p])
  const legs: Leg[] = []
  for (const [day, places] of byDay) {
    for (let i = 1; i < places.length; i++) {
      const a = places[i - 1]
      const b = places[i]
      try {
        if (meters(a, b) <= WALK_LIMIT_M) {
          const w = await walk(a, b)
          if (w) legs.push({ from: a.id, to: b.id, mode: "walk", ...w })
        } else {
          const [plan] = await planTransit(a, b, { day, timeZone, ...timing(a, b), count: 1 })
          if (plan) legs.push({ from: a.id, to: b.id, mode: "transit", minutes: plan.minutes, meters: Math.round(meters(a, b)), rides: plan.rides })
        }
      } catch {
        // The community server is down or slow; the page shows the places without this leg.
      }
    }
  }
  return legs
}

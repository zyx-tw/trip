import { country } from "@/lib/countries"
import { canRead } from "@/lib/server/auth"
import { Busy, routeBetween } from "@/lib/server/routing"

const point = (value: string | null) => {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value ?? "")
  const [lat, lng] = m ? [Number(m[1]), Number(m[2])] : [NaN, NaN]
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

/** A real calendar day, YYYY-MM-DD. */
const isDay = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v)
}
/** A clock time, HH:MM. */
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

/**
 * How to get between two points, with the path of each part for a map:
 * /api/route?from=lat,lng&to=lat,lng[&country=jp][&day=YYYY-MM-DD&time=HH:MM].
 * Without day and time it leaves now, in the country's time zone.
 */
export async function GET(req: Request) {
  if (!(await canRead(req))) return new Response(null, { status: 401 })
  const q = new URL(req.url).searchParams
  const from = point(q.get("from"))
  const to = point(q.get("to"))
  if (!from || !to) return Response.json({ error: "from and to must be lat,lng" }, { status: 400 })
  const timeZone = country(q.get("country") ?? "jp").timeZone
  const now = new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date())
  const day = q.get("day") ?? now.slice(0, 10)
  // Leaving now: to the minute, so no trip that has already left comes back.
  const time = q.get("time") ?? now.slice(11, 16)
  if (!isDay(day) || !isTime(time)) return Response.json({ error: "day must be YYYY-MM-DD and time HH:MM" }, { status: 400 })
  try {
    const route = await routeBetween(from, to, { day, time, timeZone })
    if (!route) return Response.json({ error: "no route found" }, { status: 404 })
    return Response.json(route, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    if (error instanceof Busy) return Response.json({ error: "busy; try again in a few seconds" }, { status: 503 })
    // The community routing servers are down or slow.
    console.error("route failed", error)
    return Response.json({ error: "the routing service failed; try again in a minute" }, { status: 502 })
  }
}

import { country } from "@/lib/countries"
import { canRead } from "@/lib/server/auth"
import { routeBetween } from "@/lib/server/routing"

const point = (value: string | null) => {
  const [lat, lng] = (value ?? "").split(",").map(Number)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

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
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get("day") ?? "") ? q.get("day")! : now.slice(0, 10)
  // Rounded down to 10 minutes, so asking again soon reuses the answer.
  const time = /^\d{2}:\d{2}$/.test(q.get("time") ?? "") ? q.get("time")! : `${now.slice(11, 15)}0`
  try {
    const route = await routeBetween(from, to, { day, time, timeZone })
    if (!route) return Response.json({ error: "no route found" }, { status: 404 })
    return Response.json(route, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    // The community routing servers are down or slow.
    console.error("route failed", error)
    return Response.json({ error: "the routing service failed; try again in a minute" }, { status: 502 })
  }
}

import { country } from "@/lib/countries"
import { canRead } from "@/lib/server/auth"
import { Busy, departuresFrom } from "@/lib/server/routing"

/**
 * The next departures from a station, with each line's status:
 * /api/departures?at=lat,lng&name=<station>[&country=jp]. The name is the station's
 * name from /api/stations; it keeps out the platforms of other stations nearby.
 */
export async function GET(req: Request) {
  if (!(await canRead(req))) return new Response(null, { status: 401 })
  const q = new URL(req.url).searchParams
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(q.get("at") ?? "")
  const at = m && { lat: Number(m[1]), lng: Number(m[2]) }
  const name = (q.get("name") ?? "").trim()
  if (!at || Math.abs(at.lat) > 90 || Math.abs(at.lng) > 180 || !name || name.length > 60)
    return Response.json({ error: "at must be lat,lng and name the station's name" }, { status: 400 })
  const timeZone = country(q.get("country") ?? "jp").timeZone
  try {
    const departures = await departuresFrom(at, name, timeZone)
    return Response.json({ departures }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    if (error instanceof Busy) return Response.json({ error: "busy; try again in a few seconds" }, { status: 503 })
    console.error("departures failed", error)
    return Response.json({ error: "the timetable service failed; try again in a minute" }, { status: 502 })
  }
}

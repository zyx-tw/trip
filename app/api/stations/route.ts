import { canRead } from "@/lib/server/auth"
import { TooWide, parseBbox, stationsIn } from "@/lib/server/stations"

/** Stations and exits in a view: /api/stations?bbox=south,west,north,east. Map data © OpenStreetMap contributors. */
export async function GET(req: Request) {
  if (!(await canRead(req))) return new Response(null, { status: 401 })
  const bbox = parseBbox(new URL(req.url).searchParams.get("bbox"))
  if (!bbox) return Response.json({ error: "bbox must be south,west,north,east" }, { status: 400 })
  try {
    return Response.json(stationsIn(bbox), { headers: { "cache-control": "private, max-age=86400" } })
  } catch (error) {
    if (error instanceof TooWide) return Response.json({ error: error.message }, { status: 422 })
    throw error
  }
}

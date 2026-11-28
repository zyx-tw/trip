import { canRead } from "@/lib/server/auth"
import { getTrip } from "@/lib/server/trips"

export async function GET(req: Request, ctx: RouteContext<"/api/trips/[id]">) {
  if (!(await canRead(req))) return new Response(null, { status: 401 })
  const trip = getTrip((await ctx.params).id)
  if (!trip) return new Response(null, { status: 404 })
  return Response.json(trip, { headers: { "cache-control": "no-store" } })
}

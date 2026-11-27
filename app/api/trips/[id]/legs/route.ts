import { signedIn } from "@/lib/server/auth"
import { tripLegs } from "@/lib/server/routing"
import { getTrip } from "@/lib/server/trips"

// Walks and transit between the places of each day. Slow the first time
// (community servers, 1 request a second), cached after that.
export async function GET(req: Request, ctx: RouteContext<"/api/trips/[id]/legs">) {
  if (!(await signedIn(req.headers.get("cookie")))) return new Response(null, { status: 401 })
  const trip = getTrip((await ctx.params).id)
  if (!trip) return new Response(null, { status: 404 })
  return Response.json(await tripLegs(trip), { headers: { "cache-control": "no-store" } })
}

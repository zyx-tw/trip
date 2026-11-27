import { signedIn } from "@/lib/server/auth"
import { subscribe } from "@/lib/server/events"

// Server-sent events: "change" each time the trip is written, so the page refetches.
export async function GET(req: Request, ctx: RouteContext<"/api/trips/[id]/events">) {
  if (!(await signedIn(req.headers.get("cookie")))) return new Response(null, { status: 401 })
  const { id } = await ctx.params
  const encoder = new TextEncoder()
  let stop = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const send = (line: string) => controller.enqueue(encoder.encode(line))
      send(": open\n\n")
      const off = subscribe((tripId) => tripId === id && send("event: change\ndata: {}\n\n"))
      const ping = setInterval(() => send(": ping\n\n"), 25_000)
      stop = () => {
        off()
        clearInterval(ping)
      }
      req.signal.addEventListener("abort", () => {
        stop()
        controller.close()
      })
    },
    cancel() {
      stop()
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } })
}

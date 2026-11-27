import { EventEmitter } from "node:events"

// One emitter per process: a write names the trip it changed, and every open
// page of that trip reloads it over /api/trips/<id>/events.
const g = globalThis as unknown as { tripEvents?: EventEmitter }
const events = (g.tripEvents ??= new EventEmitter().setMaxListeners(0))

export function emit(tripId: string) {
  events.emit("change", tripId)
}

export function subscribe(listener: (tripId: string) => void) {
  events.on("change", listener)
  return () => events.off("change", listener)
}

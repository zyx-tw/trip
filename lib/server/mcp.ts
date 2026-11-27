import { COUNTRIES, country } from "../countries"
import { CATEGORIES } from "../types"
import { InputError, addPlaces, deletePlaces, deleteTrip, getTrip, listTrips, saveTrip, updatePlace } from "./trips"

// MCP over streamable HTTP, without sessions or streams: each POST carries one
// JSON-RPC message and gets one JSON answer.

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]

type Args = Record<string, unknown>
type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean>; run: (args: Args) => unknown }

const object = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false })
const str = (description: string) => ({ type: "string", description })
const date = (description: string) => ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description })

const placeFields = {
  name: str("The official name as written in the country, for example the Japanese name in Japan."),
  name_zh: str("The name in Traditional Chinese (台灣用語). Translate the meaning; keep a brand name as is. Empty when it would be the same."),
  category: { type: "string", enum: [...CATEGORIES] },
  lat: { type: "number", minimum: -90, maximum: 90 },
  lng: { type: "number", minimum: -180, maximum: 180 },
  day: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The day it is planned for, inside the trip's dates. null or absent: a candidate with no day yet." },
  position: { type: "integer", description: "Order within its day, lower first. Default: last." },
  address: str("The address in the country's language."),
  note: str("Why go, what to order, opening hours, in Traditional Chinese."),
  url: str("The official site or social account."),
  google_place_id: str("The Google Maps place id, when known. Makes the Google link open the exact place."),
}

/** Each place with the map links the trip's country uses. */
function withLinks(tripId: string) {
  const trip = getTrip(tripId)
  if (!trip) throw new InputError(`no trip "${tripId}"; list_trips shows the ids`)
  const c = country(trip.country)
  return { ...trip, places: trip.places.map((p) => ({ ...p, links: c.placeLinks(p), routes: c.routeLinks(p) })) }
}

const tools: Tool[] = [
  {
    name: "list_trips",
    description: "Every trip, newest first: id, title, country and dates.",
    inputSchema: object(),
    annotations: { readOnlyHint: true },
    run: () => listTrips(),
  },
  {
    name: "get_trip",
    description: "One trip with all its places, ordered by day then position. Places without a day are candidates. Each place carries its map links.",
    inputSchema: object({ trip: str("The trip id.") }, ["trip"]),
    annotations: { readOnlyHint: true },
    run: (a) => withLinks(String(a.trip)),
  },
  {
    name: "save_trip",
    description: `Create a trip, or change the fields given on an existing one. A new trip needs every field but note. Countries: ${Object.keys(COUNTRIES).join(", ")}.`,
    inputSchema: object(
      {
        id: str("Lower-case letters, digits and dashes; it becomes the page address, for example 2027-tokyo."),
        title: str("Shown as the page title, in Traditional Chinese."),
        country: { type: "string", enum: Object.keys(COUNTRIES) },
        start_date: date("First day, YYYY-MM-DD."),
        end_date: date("Last day, YYYY-MM-DD."),
        note: str("Anything about the whole trip."),
      },
      ["id"],
    ),
    annotations: { idempotentHint: true },
    run: (a) => saveTrip(a),
  },
  {
    name: "delete_trip",
    description: "Delete a trip and all its places. Cannot be undone.",
    inputSchema: object({ trip: str("The trip id.") }, ["trip"]),
    annotations: { destructiveHint: true },
    run: (a) => deleteTrip(a.trip),
  },
  {
    name: "add_places",
    description:
      "Add 1 to 100 places to a trip in one call. Look up each place first and give its real coordinates, its official name in the country's language and a Traditional Chinese name. Open pages of the trip update at once.",
    inputSchema: object(
      {
        trip: str("The trip id."),
        places: { type: "array", minItems: 1, maxItems: 100, items: object(placeFields, ["name", "lat", "lng"]) },
      },
      ["trip", "places"],
    ),
    run: (a) => addPlaces(a.trip, a.places),
  },
  {
    name: "update_place",
    description: "Change the fields given on one place: move it to another day or position, fix its name or coordinates, add a note. day=null makes it a candidate again.",
    inputSchema: object({ id: str("The place id from get_trip."), ...placeFields }, ["id"]),
    annotations: { idempotentHint: true },
    run: (a) => updatePlace(a),
  },
  {
    name: "delete_places",
    description: "Delete places by id.",
    inputSchema: object({ ids: { type: "array", minItems: 1, items: { type: "string" } } }, ["ids"]),
    annotations: { destructiveHint: true },
    run: (a) => deletePlaces(a.ids),
  },
]

const json = (body: unknown, status = 200) => Response.json(body, { status })
const answer = (id: unknown, result: unknown) => json({ jsonrpc: "2.0", id, result })
const fail = (id: unknown, code: number, message: string) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })

export async function handleMcp(req: Request): Promise<Response> {
  let message: Args
  try {
    message = (await req.json()) as Args
  } catch {
    return fail(null, -32700, "parse error")
  }
  const { id, method } = message
  const params = (message.params ?? {}) as Args
  // A notification has no id and gets no body.
  if (id === undefined) return new Response(null, { status: 202 })
  if (method === "initialize") {
    const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : ""
    return answer(id, {
      protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: "trip", version: "1" },
      instructions:
        "Trips on trip.zyx.tw: a trip has days, a day has places in order. Look up real coordinates and official names before add_places. Write names and notes for a reader of Traditional Chinese (台灣用語).",
    })
  }
  if (method === "ping") return answer(id, {})
  if (method === "tools/list") return answer(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) })
  if (method === "tools/call") {
    const tool = tools.find((t) => t.name === params.name)
    if (!tool) return fail(id, -32602, `unknown tool ${String(params.name)}`)
    try {
      const result = tool.run((params.arguments ?? {}) as Args)
      return answer(id, { content: [{ type: "text", text: JSON.stringify(result) }] })
    } catch (error) {
      if (!(error instanceof InputError)) throw error
      return answer(id, { content: [{ type: "text", text: error.message }], isError: true })
    }
  }
  return fail(id, -32601, "method not found")
}

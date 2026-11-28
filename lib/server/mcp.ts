import { COUNTRIES, country } from "../countries"
import { CATEGORIES } from "../types"
import { departuresFrom, meters, planTransit } from "./routing"
import { TooWide, stationsIn } from "./stations"
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
  time: { type: ["string", "null"], pattern: "^\\d{2}:\\d{2}$", description: "When to be there, HH:MM local time. The page plans transit to arrive by then. For a stay: the check-in time." },
  until: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "For a hotel or other stay: the check-out day; day is the check-in day. Each day in between starts at the stay and each night ends there, so the page plans the route from and back to it." },
  address: str("The address in the country's language."),
  note: str("Why go, what to order, opening hours, in Traditional Chinese."),
  url: str("The official site or social account."),
  google_place_id: str("The Google Maps place id (ChIJ...) of the business. The page links to its Google business page only when this is set."),
  photos: { type: "array", maxItems: 6, items: { type: "string" }, description: "Up to 6 https addresses of pictures of this exact place, shown full width when it is selected. Replaces the list." },
  pages: {
    type: "array",
    maxItems: 6,
    items: { type: "object", properties: { label: { type: "string", description: "Short: 官網, Instagram, X, 食べログ." }, url: { type: "string", description: "http or https." } }, required: ["label", "url"], additionalProperties: false },
    description: "Other pages about the place, shown as links after the map apps. Replaces the list.",
  },
  apple_place_id: str("The Apple Maps place id (the place-id in a maps.apple.com/place link, I...). The page links to its Apple business page only when this is set."),
}

/** Each place with the map links the trip's country uses. */
function withLinks(tripId: string) {
  const trip = getTrip(tripId)
  if (!trip) throw new InputError(`no trip "${tripId}"; list_trips shows the ids`)
  const c = country(trip.country)
  return { ...trip, places: trip.places.map((p) => ({ ...p, links: c.placeLinks(p) })) }
}

const point = { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } }, required: ["lat", "lng"], additionalProperties: false }

async function planRoute(a: Args) {
  const from = a.from as { lat?: unknown; lng?: unknown } | undefined
  const to = a.to as { lat?: unknown; lng?: unknown } | undefined
  const ok = (p: typeof from): p is { lat: number; lng: number } => !!p && typeof p.lat === "number" && typeof p.lng === "number"
  if (!ok(from) || !ok(to)) throw new InputError("from and to need lat and lng")
  if (typeof a.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new InputError("date must be YYYY-MM-DD")
  const time = typeof a.time === "string" && /^\d{2}:\d{2}$/.test(a.time) ? a.time : "09:00"
  const timeZone = country(typeof a.country === "string" ? a.country : "jp").timeZone
  try {
    return await planTransit(from, to, { day: a.date, time, arriveBy: a.arrive_by === true, timeZone, count: 5 })
  } catch (error) {
    throw new InputError(`the timetable service failed: ${(error as Error).message}. Try again in a minute.`)
  }
}

async function stationDepartures(a: Args) {
  const { lat, lng, name } = a as { lat?: unknown; lng?: unknown; name?: unknown }
  if (typeof lat !== "number" || typeof lng !== "number" || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180))
    throw new InputError("lat must be within ±90 and lng within ±180")
  if (typeof name !== "string" || !name.trim()) throw new InputError("name is the station's name")
  try {
    return { departures: await departuresFrom({ lat, lng }, name.trim(), country("jp").timeZone) }
  } catch (error) {
    throw new InputError(`the timetable service failed: ${(error as Error).message}. Try again in a minute.`)
  }
}

function findStations(a: Args) {
  const { lat, lng } = a as { lat?: unknown; lng?: unknown }
  if (typeof lat !== "number" || typeof lng !== "number" || !(Math.abs(lat) <= 85) || !(Math.abs(lng) <= 180))
    throw new InputError("lat must be within ±85 and lng within ±180")
  const radius = typeof a.radius === "number" ? Math.min(Math.max(a.radius, 100), 3000) : 600
  const dLat = radius / 111_320
  const dLng = radius / (111_320 * Math.cos((lat * Math.PI) / 180))
  // The box picks candidates; the distance keeps the ones within the radius.
  const near = (p: { lat: number; lng: number }) => meters({ lat, lng }, p) <= radius
  try {
    const found = stationsIn({ south: lat - dLat, west: lng - dLng, north: lat + dLat, east: lng + dLng })
    return { stations: found.stations.filter(near), exits: found.exits.filter(near) }
  } catch (error) {
    if (error instanceof TooWide || error instanceof RangeError) throw new InputError(error.message)
    throw error
  }
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
    description: `Create a trip, or change the fields given on an existing one. A new trip needs every field but note. Shortening the dates moves places on dropped days back to the candidates. Countries: ${Object.keys(COUNTRIES).join(", ")}.`,
    inputSchema: object(
      {
        id: str("Lower-case letters, digits and dashes; it becomes the page address, for example 2027-tokyo."),
        title: str("Shown as the page title, in Traditional Chinese."),
        country: { type: "string", enum: Object.keys(COUNTRIES) },
        start_date: date("First day, YYYY-MM-DD."),
        end_date: date("Last day, YYYY-MM-DD."),
        note: str("Anything about the whole trip."),
        new_id: str("A new id for an existing trip; its page moves to the new address and the old one stops working."),
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
    name: "plan_route",
    description:
      "Trains and buses from one point to another on a date, from the Transitous timetable: up to 5 trips with each ride's name (for example あさま605号), stations and times in local time. Use it to pick a train, then write the choice in a place's note or time. Times are timetable data, not live.",
    inputSchema: object(
      {
        from: point,
        to: point,
        date: date("The travel date, YYYY-MM-DD."),
        time: str("HH:MM local time. Default 09:00."),
        arrive_by: { type: "boolean", description: "true: arrive by time. false (default): leave from time on." },
        country: { type: "string", enum: Object.keys(COUNTRIES), description: "Sets the time zone. Default jp." },
      },
      ["from", "to", "date"],
    ),
    annotations: { readOnlyHint: true },
    run: planRoute,
  },
  {
    name: "find_stations",
    description:
      "Railway and subway stations and their exits (出口, with the number on the sign, for example A3) around a point, from OpenStreetMap. Use it to tell someone which exit to take for a place.",
    inputSchema: object(
      {
        lat: { type: "number", minimum: -90, maximum: 90 },
        lng: { type: "number", minimum: -180, maximum: 180 },
        radius: { type: "number", description: "Meters around the point, 100 to 3000. Default 600." },
      },
      ["lat", "lng"],
    ),
    annotations: { readOnlyHint: true },
    run: findStations,
  },
  {
    name: "station_departures",
    description:
      "The next trains leaving a station, leaving now: time, line, where it goes, platform, and the line's status (遅延, 運転見合わせ) when it has one. Take the station's name and position from find_stations.",
    inputSchema: object(
      {
        name: str("The station's name as find_stations gives it, for example 東京."),
        lat: { type: "number", minimum: -90, maximum: 90 },
        lng: { type: "number", minimum: -180, maximum: 180 },
      },
      ["name", "lat", "lng"],
    ),
    annotations: { readOnlyHint: true },
    run: stationDepartures,
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
  if (!message || typeof message !== "object" || Array.isArray(message)) return fail(null, -32600, "send one JSON-RPC request object")
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
      const result = await tool.run((params.arguments ?? {}) as Args)
      return answer(id, { content: [{ type: "text", text: JSON.stringify(result) }] })
    } catch (error) {
      if (!(error instanceof InputError)) throw error
      return answer(id, { content: [{ type: "text", text: error.message }], isError: true })
    }
  }
  return fail(id, -32601, "method not found")
}

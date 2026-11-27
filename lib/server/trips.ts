import { randomBytes } from "node:crypto"
import { COUNTRIES } from "../countries"
import { CATEGORIES, type Category, type Place, type Trip, type TripWithPlaces } from "../types"
import { db } from "./db"
import { emit } from "./events"

/** A mistake in the caller's input. The message says what to fix. */
export class InputError extends Error {}

type Row = Record<string, unknown>

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/

const toTrip = (r: Row): Trip => ({
  id: String(r.id),
  title: String(r.title),
  country: String(r.country),
  startDate: String(r.start_date),
  endDate: String(r.end_date),
  note: String(r.note),
})

const toPlace = (r: Row): Place => ({
  id: String(r.id),
  tripId: String(r.trip_id),
  day: r.day == null ? null : String(r.day),
  position: Number(r.position),
  name: String(r.name),
  nameZh: String(r.name_zh),
  category: String(r.category) as Category,
  lat: Number(r.lat),
  lng: Number(r.lng),
  address: String(r.address),
  note: String(r.note),
  url: String(r.url),
  googlePlaceId: String(r.google_place_id),
})

function text(value: unknown, field: string, max = 500): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new InputError(`${field} must be a string`)
  const v = value.trim()
  if (v.length > max) throw new InputError(`${field} is longer than ${max} characters`)
  return v
}

function date(value: unknown, field: string): string | undefined {
  const v = text(value, field, 10)
  if (v === undefined) return undefined
  if (!DATE.test(v) || Number.isNaN(Date.parse(v))) throw new InputError(`${field} must be a date as YYYY-MM-DD`)
  return v
}

function coord(value: unknown, field: string, limit: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) throw new InputError(`${field} must be a number between -${limit} and ${limit}`)
  return value
}

function category(value: unknown): Category | undefined {
  if (value === undefined) return undefined
  if (!CATEGORIES.includes(value as Category)) throw new InputError(`category must be one of ${CATEGORIES.join(", ")}`)
  return value as Category
}

const newId = () => randomBytes(6).toString("base64url")

export function listTrips(): Trip[] {
  return db().prepare("select * from trips order by start_date desc").all().map(toTrip)
}

export function getTrip(id: string): TripWithPlaces | null {
  const row = db().prepare("select * from trips where id = ?").get(id)
  if (!row) return null
  const places = db().prepare("select * from places where trip_id = ? order by day is null, day, position, created_at").all(id).map(toPlace)
  return { ...toTrip(row), places }
}

function requireTrip(id: unknown): Trip {
  if (typeof id !== "string") throw new InputError("trip is required")
  const row = db().prepare("select * from trips where id = ?").get(id)
  if (!row) throw new InputError(`no trip "${id}"; list_trips shows the ids`)
  return toTrip(row)
}

/** Creates the trip when the id is new, else changes the fields given. */
export function saveTrip(input: Row): Trip {
  const id = text(input.id, "id", 48)
  if (!id || !SLUG.test(id)) throw new InputError("id must be 2 to 48 lower-case letters, digits or dashes, for example 2027-tokyo")
  const existing = db().prepare("select * from trips where id = ?").get(id)
  const title = text(input.title, "title", 80)
  const country = text(input.country, "country", 2)?.toLowerCase()
  if (country !== undefined && !(country in COUNTRIES)) throw new InputError(`country must be one of ${Object.keys(COUNTRIES).join(", ")}`)
  const startDate = date(input.start_date, "start_date")
  const endDate = date(input.end_date, "end_date")
  const note = text(input.note, "note", 2000)
  const now = Date.now()
  if (!existing) {
    if (!title || !country || !startDate || !endDate) throw new InputError("a new trip needs title, country, start_date and end_date")
    if (endDate < startDate) throw new InputError("end_date is before start_date")
    db().prepare("insert into trips (id, title, country, start_date, end_date, note, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(id, title, country, startDate, endDate, note ?? "", now, now)
  } else {
    const t = toTrip(existing)
    const next = { title: title || t.title, country: country ?? t.country, startDate: startDate ?? t.startDate, endDate: endDate ?? t.endDate, note: note ?? t.note }
    if (next.endDate < next.startDate) throw new InputError("end_date is before start_date")
    const d = db()
    d.exec("begin")
    try {
      d.prepare("update trips set title = ?, country = ?, start_date = ?, end_date = ?, note = ?, updated_at = ? where id = ?").run(next.title, next.country, next.startDate, next.endDate, next.note, now, id)
      // Places on days the trip no longer has go back to the candidates, so none disappear.
      d.prepare("update places set day = null, updated_at = ? where trip_id = ? and (day < ? or day > ?)").run(now, id, next.startDate, next.endDate)
      d.exec("commit")
    } catch (error) {
      d.exec("rollback")
      throw error
    }
  }
  emit(id)
  return requireTrip(id)
}

export function deleteTrip(id: unknown) {
  const trip = requireTrip(id)
  db().prepare("delete from trips where id = ?").run(trip.id)
  emit(trip.id)
  return { deleted: trip.id }
}

function checkDay(trip: Trip, day: string | null) {
  if (day && (day < trip.startDate || day > trip.endDate)) throw new InputError(`day ${day} is outside the trip, ${trip.startDate} to ${trip.endDate}`)
}

/** Adds places to a trip. Each goes last on its day unless it names a position. */
export function addPlaces(tripId: unknown, items: unknown): Place[] {
  const trip = requireTrip(tripId)
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw new InputError("places must be a list of 1 to 100 places")
  const d = db()
  const ids: string[] = []
  const now = Date.now()
  d.exec("begin")
  try {
    for (const [i, raw] of items.entries()) {
      const item = (raw ?? {}) as Row
      const at = `places[${i}]`
      const name = text(item.name, `${at}.name`, 200)
      const lat = coord(item.lat, `${at}.lat`, 90)
      const lng = coord(item.lng, `${at}.lng`, 180)
      if (!name || lat === undefined || lng === undefined) throw new InputError(`${at} needs name, lat and lng`)
      const day = item.day === null ? null : (date(item.day, `${at}.day`) ?? null)
      checkDay(trip, day)
      const last = d.prepare("select max(position) as p from places where trip_id = ? and day is ?").get(trip.id, day) as { p: number | null }
      const position = typeof item.position === "number" ? Math.trunc(item.position) : (last.p ?? -1) + 1
      const id = newId()
      d.prepare(
        "insert into places (id, trip_id, day, position, name, name_zh, category, lat, lng, address, note, url, google_place_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        trip.id,
        day,
        position,
        name,
        text(item.name_zh, `${at}.name_zh`, 200) ?? "",
        category(item.category) ?? "other",
        lat,
        lng,
        text(item.address, `${at}.address`) ?? "",
        text(item.note, `${at}.note`, 2000) ?? "",
        text(item.url, `${at}.url`) ?? "",
        text(item.google_place_id, `${at}.google_place_id`, 300) ?? "",
        now,
        now,
      )
      ids.push(id)
    }
    d.exec("commit")
  } catch (error) {
    d.exec("rollback")
    throw error
  }
  emit(trip.id)
  return ids.map((id) => toPlace(d.prepare("select * from places where id = ?").get(id) as Row))
}

function requirePlace(id: unknown): Place {
  if (typeof id !== "string") throw new InputError("id is required")
  const row = db().prepare("select * from places where id = ?").get(id)
  if (!row) throw new InputError(`no place "${id}"; get_trip lists the place ids`)
  return toPlace(row)
}

/** Changes the fields given. day=null moves the place back to the candidates. */
export function updatePlace(input: Row): Place {
  const place = requirePlace(input.id)
  const trip = requireTrip(place.tripId)
  const day = input.day === null ? null : (date(input.day, "day") ?? place.day)
  checkDay(trip, day)
  const next = {
    day,
    position: typeof input.position === "number" ? Math.trunc(input.position) : place.position,
    name: text(input.name, "name", 200) || place.name,
    nameZh: text(input.name_zh, "name_zh", 200) ?? place.nameZh,
    category: category(input.category) ?? place.category,
    lat: coord(input.lat, "lat", 90) ?? place.lat,
    lng: coord(input.lng, "lng", 180) ?? place.lng,
    address: text(input.address, "address") ?? place.address,
    note: text(input.note, "note", 2000) ?? place.note,
    url: text(input.url, "url") ?? place.url,
    googlePlaceId: text(input.google_place_id, "google_place_id", 300) ?? place.googlePlaceId,
  }
  db()
    .prepare("update places set day = ?, position = ?, name = ?, name_zh = ?, category = ?, lat = ?, lng = ?, address = ?, note = ?, url = ?, google_place_id = ?, updated_at = ? where id = ?")
    .run(next.day, next.position, next.name, next.nameZh, next.category, next.lat, next.lng, next.address, next.note, next.url, next.googlePlaceId, Date.now(), place.id)
  emit(place.tripId)
  return requirePlace(place.id)
}

export function deletePlaces(ids: unknown) {
  if (!Array.isArray(ids) || ids.length === 0) throw new InputError("ids must be a list of place ids")
  const places = ids.map(requirePlace)
  for (const p of places) db().prepare("delete from places where id = ?").run(p.id)
  for (const tripId of new Set(places.map((p) => p.tripId))) emit(tripId)
  return { deleted: places.map((p) => p.id) }
}

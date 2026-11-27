import { expect, test } from "bun:test"

import type { Place, TripWithPlaces } from "../types"
import { dayStops } from "./routing"

const place = (
  id: string,
  day: string | null,
  until: string | null = null,
  position = 0
): Place => ({
  id,
  tripId: "t",
  day,
  position,
  time: null,
  until,
  name: id,
  nameZh: "",
  category: "other",
  lat: 0,
  lng: 0,
  address: "",
  note: "",
  url: "",
  googlePlaceId: "",
  applePlaceId: "",
  photos: [],
  pages: [],
})

const trip: TripWithPlaces = {
  id: "t",
  title: "t",
  country: "jp",
  startDate: "2027-01-04",
  endDate: "2027-01-11",
  note: "",
  places: [
    place("hotelA", "2027-01-06", "2027-01-08"),
    place("ski", "2027-01-07"),
    place("hotelB", "2027-01-08", "2027-01-11"),
    place("cafe", "2027-01-09"),
  ],
}
const ids = (day: string) =>
  dayStops(trip, day).map((s) => `${s.role}:${s.place.id}`)

test("a day between check-in and check-out starts and ends at the stay", () => {
  expect(ids("2027-01-07")).toEqual(["start:hotelA", "stop:ski", "end:hotelA"])
})

test("moving day goes from one stay to the next, once", () => {
  expect(ids("2027-01-08")).toEqual(["start:hotelA", "stop:hotelB"])
})

test("check-out day starts at the stay and has no night", () => {
  expect(ids("2027-01-11")).toEqual(["start:hotelB"])
  expect(ids("2027-01-09")).toEqual(["start:hotelB", "stop:cafe", "end:hotelB"])
})

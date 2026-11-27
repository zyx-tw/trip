import { expect, test } from "bun:test"

import { daysOf, formatDay } from "../dates"
import type { Place } from "../types"
import { jp } from "./jp"

const place: Place = {
  id: "a",
  tripId: "t",
  day: null,
  position: 0,
  name: "ひみつ堂",
  nameZh: "祕密堂",
  category: "sweets",
  lat: 35.727333,
  lng: 139.766617,
  address: "東京都台東区谷中3-11-18",
  note: "",
  url: "",
  googlePlaceId: "",
}

test("Japan opens Google first, then Apple", () => {
  const [google, apple] = jp.placeLinks(place)
  expect(google.url).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("ひみつ堂 東京都台東区谷中3-11-18")}`)
  expect(apple.url).toBe(`https://maps.apple.com/place?coordinate=35.727333,139.766617&name=${encodeURIComponent("ひみつ堂")}`)
})

test("a Google place id names the exact place", () => {
  const [google] = jp.placeLinks({ ...place, googlePlaceId: "ChIJ123" })
  expect(google.url).toEndWith("&query_place_id=ChIJ123")
  const [route] = jp.routeLinks({ ...place, googlePlaceId: "ChIJ123" })
  expect(route.url).toContain("&destination_place_id=ChIJ123&travelmode=transit")
})

test("days run from start to end, inclusive", () => {
  expect(daysOf("2027-01-04", "2027-01-11")).toHaveLength(8)
  expect(formatDay("2027-01-04")).toBe("1/4 (一)")
})

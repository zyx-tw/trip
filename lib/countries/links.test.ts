import { expect, test } from "bun:test"

import { daysOf, formatDay } from "../dates"
import type { Place } from "../types"
import { jp } from "./jp"

const place: Place = {
  id: "a",
  tripId: "t",
  day: null,
  position: 0,
  time: null,
  name: "ひみつ堂",
  nameZh: "祕密堂",
  category: "sweets",
  lat: 35.727333,
  lng: 139.766617,
  address: "東京都台東区谷中3-11-18",
  note: "",
  url: "",
  googlePlaceId: "",
  applePlaceId: "",
  photos: [],
  pages: [],
}

test("a place without ids has no links", () => {
  expect(jp.placeLinks(place)).toEqual([])
})

test("ids open the business pages, Google first", () => {
  const links = jp.placeLinks({ ...place, googlePlaceId: "ChIJ123", applePlaceId: "I456" })
  expect(links.map((l) => l.label)).toEqual(["Google", "Apple"])
  expect(links[0].url).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("ひみつ堂")}&query_place_id=ChIJ123`)
  expect(links[1].url).toBe("https://maps.apple.com/place?place-id=I456")
})

test("days run from start to end, inclusive", () => {
  expect(daysOf("2027-01-04", "2027-01-11")).toHaveLength(8)
  expect(formatDay("2027-01-04")).toBe("1/4 (一)")
})

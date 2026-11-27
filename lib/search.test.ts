import { expect, test } from "bun:test"

import { matches } from "./search"
import type { Place } from "./types"

const place: Place = {
  id: "a",
  tripId: "t",
  day: null,
  position: 0,
  time: null,
  name: "マミーズ・アン・スリール 谷中店",
  nameZh: "Mammies 蘋果派",
  category: "sweets",
  lat: 0,
  lng: 0,
  address: "東京都台東区谷中3-8-7",
  note: "",
  url: "",
  googlePlaceId: "",
  applePlaceId: "",
  photos: [],
  pages: [],
}

test("finds by name, kana, category and address", () => {
  expect(matches(place, "まみーず")).toBe(true)
  expect(matches(place, "mammies")).toBe(true)
  expect(matches(place, "甜點")).toBe(true)
  expect(matches(place, "谷中 蘋果")).toBe(true)
})

test("letters in order still match a name", () => {
  expect(matches(place, "mmies")).toBe(true)
  expect(matches(place, "蘋派")).toBe(true)
})

test("extra text such as the day is searched too", () => {
  expect(matches(place, "1/5", "1/5 (二)")).toBe(true)
  expect(matches(place, "1/6", "1/5 (二)")).toBe(false)
})

test("a word that is nowhere does not match", () => {
  expect(matches(place, "拉麵")).toBe(false)
})

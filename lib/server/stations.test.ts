import { describe, expect, test } from "bun:test"
import { decodePolyline } from "./routing"
import { parseBbox } from "./stations"

describe("parseBbox", () => {
  test("reads south,west,north,east", () => {
    expect(parseBbox("35.6,139.7,35.7,139.8")).toEqual({ south: 35.6, west: 139.7, north: 35.7, east: 139.8 })
  })
  test("refuses a box turned inside out or out of range", () => {
    expect(parseBbox("35.7,139.7,35.6,139.8")).toBeNull()
    expect(parseBbox("35.6,139.7,95,139.8")).toBeNull()
    expect(parseBbox("a,b,c,d")).toBeNull()
    expect(parseBbox(null)).toBeNull()
  })
})

describe("decodePolyline", () => {
  test("decodes Google's example at precision 5 as [lng, lat]", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
  })
})

import type { Country } from "."
import { applePlace, appleRoute, googlePlace, googleRoute } from "./links"

export const jp: Country = {
  code: "jp",
  name: "日本",
  timeZone: "Asia/Tokyo",
  placeLinks: (p) => [googlePlace(p), applePlace(p)],
  routeLinks: (p) => [googleRoute(p, "transit"), appleRoute(p, "transit")],
}

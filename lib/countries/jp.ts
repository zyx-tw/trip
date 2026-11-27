import type { Country } from "."
import { applePlace, googlePlace } from "./links"

export const jp: Country = {
  code: "jp",
  name: "日本",
  timeZone: "Asia/Tokyo",
  placeLinks: (p) => [...googlePlace(p), ...applePlace(p)],
}

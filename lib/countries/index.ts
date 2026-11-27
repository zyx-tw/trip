import type { Place } from "../types"
import { jp } from "./jp"

export type MapLink = { label: string; url: string }

/**
 * What changes from one country to the next. Add a country by adding one file
 * that exports a Country and listing it below.
 */
export type Country = {
  code: string
  name: string
  /** IANA time zone the trip's times are written in. */
  timeZone: string
  /** Map apps that open this place, most used there first. */
  placeLinks: (place: Place) => MapLink[]
  /** Map apps that route to this place by public transport. */
  routeLinks: (place: Place) => MapLink[]
}

export const COUNTRIES: Record<string, Country> = { jp }

export function country(code: string): Country {
  return COUNTRIES[code] ?? jp
}

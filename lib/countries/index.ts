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
  /** The place's business pages in the map apps used there, most used first; only those it has. */
  placeLinks: (place: Place) => MapLink[]
}

export const COUNTRIES: Record<string, Country> = { jp }

export function country(code: string): Country {
  return Object.hasOwn(COUNTRIES, code) ? COUNTRIES[code] : jp
}

import type { Place } from "../types"
import type { MapLink } from "."

// Business pages in map apps used in more than one country. A country file
// picks the ones it needs. A place without the app's id gets no link.

const q = encodeURIComponent

/** https://developers.google.com/maps/documentation/urls/get-started */
export function googlePlace(p: Place): MapLink[] {
  if (!p.googlePlaceId) return []
  return [{ label: "Google", url: `https://www.google.com/maps/search/?api=1&query=${q(p.name)}&query_place_id=${q(p.googlePlaceId)}` }]
}

/** https://developer.apple.com/documentation/mapkit/unified-map-urls */
export function applePlace(p: Place): MapLink[] {
  if (!p.applePlaceId) return []
  return [{ label: "Apple", url: `https://maps.apple.com/place?place-id=${q(p.applePlaceId)}` }]
}

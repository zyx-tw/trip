import type { Place } from "../types"
import type { MapLink } from "."

// Map apps used in more than one country. A country file picks the ones it needs.

const q = encodeURIComponent
const at = (p: Place) => `${p.lat},${p.lng}`

/** https://developers.google.com/maps/documentation/urls/get-started */
export function googlePlace(p: Place): MapLink {
  const query = p.googlePlaceId ? p.name : `${p.name} ${p.address}`.trim() || at(p)
  const id = p.googlePlaceId ? `&query_place_id=${q(p.googlePlaceId)}` : ""
  return { label: "Google", url: `https://www.google.com/maps/search/?api=1&query=${q(query)}${id}` }
}

export function googleRoute(p: Place, mode: "transit" | "walking"): MapLink {
  const id = p.googlePlaceId ? `&destination_place_id=${q(p.googlePlaceId)}` : ""
  const destination = p.googlePlaceId ? p.name : at(p)
  return { label: "Google", url: `https://www.google.com/maps/dir/?api=1&destination=${q(destination)}${id}&travelmode=${mode}` }
}

/** https://developer.apple.com/documentation/mapkit/unified-map-urls */
export function applePlace(p: Place): MapLink {
  return { label: "Apple", url: `https://maps.apple.com/place?coordinate=${at(p)}&name=${q(p.name)}` }
}

export function appleRoute(p: Place, mode: "transit" | "walking"): MapLink {
  return { label: "Apple", url: `https://maps.apple.com/directions?destination=${at(p)}&mode=${mode}` }
}

export const CATEGORIES = [
  "sight",
  "food",
  "cafe",
  "sweets",
  "shop",
  "hotel",
  "station",
  "airport",
  "other",
] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  sight: "景點",
  food: "餐廳",
  cafe: "咖啡",
  sweets: "甜點",
  shop: "商店",
  hotel: "住宿",
  station: "車站",
  airport: "機場",
  other: "其他",
}

/** The pin on the map and the mark in the list for each category. U+FE0F asks for the emoji, not the text glyph. */
export const CATEGORY_EMOJI: Record<Category, string> = {
  sight: "⛩️",
  food: "🍜",
  cafe: "\u2615\ufe0f",
  sweets: "🍧",
  shop: "🛍️",
  hotel: "🏨",
  station: "🚉",
  airport: "\u2708\ufe0f",
  other: "📍",
}

export type Place = {
  id: string
  tripId: string
  /** The day it is planned for, YYYY-MM-DD, or null while it is only a candidate. */
  day: string | null
  position: number
  /** When to be there, HH:MM in the trip's time zone, or null. Transit to it arrives by then. */
  time: string | null
  /** For a stay: the check-out day. Each day after \`day\` up to it starts here, and each night before it ends here. */
  until: string | null
  /** The name as written in the country, for example in Japanese. */
  name: string
  /** The name in Traditional Chinese, empty when it is the same. */
  nameZh: string
  category: Category
  lat: number
  lng: number
  address: string
  note: string
  url: string
  /** The place's business page in Google Maps; empty when it has none. */
  googlePlaceId: string
  /** The place's business page in Apple Maps; empty when it has none. */
  applePlaceId: string
  /** Pictures of the place, https addresses, shown when it is selected. */
  photos: string[]
  /** Other pages about the place: its own site, Instagram, Tabelog. */
  pages: PageLink[]
}

export type PageLink = { label: string; url: string }

export type Trip = {
  id: string
  title: string
  /** ISO 3166-1 alpha-2, lower case: jp, kr. */
  country: string
  startDate: string
  endDate: string
  note: string
}

export type TripWithPlaces = Trip & { places: Place[] }

/** One way to get from a place to the next one on the same day. */
export type Leg = {
  /** The day it is travelled, YYYY-MM-DD. */
  day: string
  from: string
  to: string
  mode: "walk" | "transit"
  minutes: number
  meters: number
  /** [lng, lat] points of a walk, for the map. */
  line?: [number, number][]
  /** Each ride of a transit trip, in order. */
  rides?: Ride[]
}

export type Ride = {
  name: string
  from: string
  to: string
  /** HH:MM in the trip's time zone. */
  departs: string
  arrives: string
  headsign: string
}

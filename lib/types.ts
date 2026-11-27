export const CATEGORIES = ["sight", "food", "cafe", "sweets", "shop", "hotel", "station", "other"] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  sight: "景點",
  food: "餐廳",
  cafe: "咖啡",
  sweets: "甜點",
  shop: "商店",
  hotel: "住宿",
  station: "車站",
  other: "其他",
}

export type Place = {
  id: string
  tripId: string
  /** The day it is planned for, YYYY-MM-DD, or null while it is only a candidate. */
  day: string | null
  position: number
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
  googlePlaceId: string
}

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

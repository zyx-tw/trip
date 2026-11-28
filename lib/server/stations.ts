import data from "../data/stations-jp.json"

// Stations and their exits from OpenStreetMap, built into lib/data/stations-jp.json
// by scripts/build-stations.ts. Data © OpenStreetMap contributors, ODbL.
// Bundled rather than asked live: the public Overpass servers are often busy.

/** The side of an index cell in degrees, about 5 km in Japan. */
const CELL = 0.05
/** A view wider than this many cells is too far out to show stations in. */
const MAX_CELLS = 9

export type Station = {
  name: string
  nameEn: string
  /** subway, or train for every other railway station. */
  kind: "subway" | "train"
  lat: number
  lng: number
}

export type Exit = {
  /** What the sign says, for example A3 or 丸の内北口; empty when the map has no name for it. */
  label: string
  lat: number
  lng: number
}

export type Bbox = { south: number; west: number; north: number; east: number }

export class TooWide extends Error {}

type File = { stations: [string, string, number, number, number][]; exits: [string, number, number][] }
type Index = { stations: Map<string, Station[]>; exits: Map<string, Exit[]> }

const g = globalThis as unknown as { tripStations?: Index }
const key = (lat: number, lng: number) => `${Math.floor(lat / CELL)},${Math.floor(lng / CELL)}`

function index(): Index {
  if (g.tripStations) return g.tripStations
  const file = data as unknown as File
  const stations = new Map<string, Station[]>()
  const exits = new Map<string, Exit[]>()
  const put = <T>(map: Map<string, T[]>, k: string, v: T) => (map.get(k) ?? map.set(k, []).get(k)!).push(v)
  for (const [name, nameEn, kind, lat, lng] of file.stations)
    put(stations, key(lat, lng), { name, nameEn, kind: kind === 1 ? "subway" : "train", lat, lng })
  for (const [label, lat, lng] of file.exits) put(exits, key(lat, lng), { label, lat, lng })
  return (g.tripStations = { stations, exits })
}

/** The stations and exits inside a view. Throws TooWide when it spans more than a few cells. */
export function stationsIn(view: Bbox): { stations: Station[]; exits: Exit[] } {
  const rows = [Math.floor(view.south / CELL), Math.floor(view.north / CELL)]
  const cols = [Math.floor(view.west / CELL), Math.floor(view.east / CELL)]
  if ((rows[1] - rows[0] + 1) * (cols[1] - cols[0] + 1) > MAX_CELLS) throw new TooWide("zoom in: the view spans too many cells")
  const inside = (p: { lat: number; lng: number }) => p.lat >= view.south && p.lat <= view.north && p.lng >= view.west && p.lng <= view.east
  const { stations, exits } = index()
  const out = { stations: [] as Station[], exits: [] as Exit[] }
  for (let r = rows[0]; r <= rows[1]; r++)
    for (let c = cols[0]; c <= cols[1]; c++) {
      out.stations.push(...(stations.get(`${r},${c}`) ?? []).filter(inside))
      out.exits.push(...(exits.get(`${r},${c}`) ?? []).filter(inside))
    }
  return out
}

/** Parses "south,west,north,east". */
export function parseBbox(value: string | null): Bbox | null {
  const n = (value ?? "").split(",").map(Number)
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null
  const [south, west, north, east] = n
  if (south >= north || west >= east || south < -90 || north > 90 || west < -180 || east > 180) return null
  return { south, west, north, east }
}

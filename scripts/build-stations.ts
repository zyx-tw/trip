// Builds lib/data/stations-jp.json: Japan's railway stations and their exits from OpenStreetMap.
// Data © OpenStreetMap contributors, ODbL. Rebuild every few months:
//
//   curl -O https://download.geofabrik.de/asia/japan-latest.osm.pbf
//   osmium tags-filter japan-latest.osm.pbf n/railway=station,subway_entrance,train_station_entrance -o rail.osm.pbf
//   osmium export rail.osm.pbf -f geojsonseq -o rail.geojsonseq
//   bun scripts/build-stations.ts rail.geojsonseq > lib/data/stations-jp.json

import { readFileSync } from "node:fs"

type Feature = { geometry: { type: string; coordinates: [number, number] }; properties: Record<string, string>; id?: string }

/** Two stations of the same name closer than this are one station with several operators. */
const SAME_STATION_M = 500

const meters = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180
  const x = Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(((b[1] - a[1]) * rad) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(x))
}
const round = (v: number) => Math.round(v * 1e6) / 1e6

const stations: [string, string, number, number, number][] = []
const exits: [string, number, number][] = []
const byName = new Map<string, number[]>()

for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  const text = line.replace(/^\x1e/, "").trim()
  if (!text) continue
  const f = JSON.parse(text) as Feature
  if (f.geometry.type !== "Point") continue
  const [lng, lat] = f.geometry.coordinates
  const t = f.properties
  if (t.railway === "station") {
    if (!t.name) continue
    const kind = t.station === "subway" ? 1 : 0
    const same = (byName.get(t.name) ?? []).find((i) => meters([stations[i][3], stations[i][4]], [lat, lng]) < SAME_STATION_M)
    if (same !== undefined) {
      // Keep one marker; a subway platform under a railway station still counts as the railway station.
      if (kind === 0 && stations[same][2] === 1) stations[same] = [t.name, t["name:en"] ?? stations[same][1], 0, round(lat), round(lng)]
      continue
    }
    byName.set(t.name, [...(byName.get(t.name) ?? []), stations.length])
    stations.push([t.name, t["name:en"] ?? "", kind, round(lat), round(lng)])
  } else {
    // Mappers put the exit number in ref, or as a short name.
    const label = t.ref ?? (t.name && t.name.length <= 10 ? t.name : "")
    exits.push([label, round(lat), round(lng)])
  }
}

process.stdout.write(JSON.stringify({ built: new Date().toISOString().slice(0, 10), stations, exits }))

// Line status for Tokyo rail (delays, suspensions) from the GTFS-Realtime alerts
// feed Transitous also reads: ODPT train information, packed by mkuran.pl.
// Transitous's plan answer leaves alerts out, so trips get them from here.

const FEED = "https://mkuran.pl/gtfs/tokyo/rail_alerts.pb"
/** How long one copy of the feed is used; the feed itself updates about every minute. */
const FRESH_MS = 60_000
/** Transitous names this feed's routes with this prefix. */
const PREFIX = "jp-tokyo-rail_"

export type Alert = { title: string; text: string }

type Store = { at: number; byRoute: Map<string, Alert>; loading?: Promise<void> }
const g = globalThis as unknown as { tripAlerts?: Store }
const store: Store = (g.tripAlerts ??= { at: 0, byRoute: new Map() })

/** The alert on a Transitous route id, if its line has one now. */
export async function alertFor(routeId: string | undefined): Promise<Alert | null> {
  if (!routeId?.startsWith(PREFIX)) return null
  await refresh()
  return store.byRoute.get(routeId.slice(PREFIX.length)) ?? null
}

async function refresh() {
  if (Date.now() - store.at < FRESH_MS) return
  store.loading ??= load().finally(() => (store.loading = undefined))
  await store.loading
}

async function load() {
  try {
    const res = await fetch(FEED, { headers: { "user-agent": "trip.zyx.tw" }, signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`alerts feed ${res.status}`)
    store.byRoute = parseAlerts(new Uint8Array(await res.arrayBuffer()))
  } catch (error) {
    // Keep the last copy; a trip without its alert is better than no trip.
    console.error("alerts failed", error)
  }
  store.at = Date.now()
}

/** Reads the route alerts out of a GTFS-Realtime FeedMessage. */
export function parseAlerts(bytes: Uint8Array): Map<string, Alert> {
  const out = new Map<string, Alert>()
  for (const entity of fields(bytes, 2)) {
    for (const alert of fields(entity, 5)) {
      const title = translated(fields(alert, 10)[0])
      const text = translated(fields(alert, 11)[0])
      if (!title && !text) continue
      for (const informed of fields(alert, 5))
        for (const route of fields(informed, 2)) out.set(utf8(route), { title, text })
    }
  }
  return out
}

/** The Japanese text of a TranslatedString, else the first one. */
function translated(bytes: Uint8Array | undefined): string {
  if (!bytes) return ""
  const all = fields(bytes, 1).map((t) => ({ text: utf8(fields(t, 1)[0]), lang: utf8(fields(t, 2)[0]) }))
  return (all.find((t) => t.lang === "ja") ?? all.find((t) => !t.lang) ?? all[0])?.text ?? ""
}

const utf8 = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : "")

/** The length-delimited fields with one number in a protobuf message. */
function fields(bytes: Uint8Array, number: number): Uint8Array[] {
  const out: Uint8Array[] = []
  let i = 0
  const varint = () => {
    let value = 0
    let shift = 0
    let byte: number
    do {
      if (i >= bytes.length) throw new Error("truncated protobuf")
      byte = bytes[i++]
      value += (byte & 0x7f) * 2 ** shift
      shift += 7
    } while (byte & 0x80)
    return value
  }
  while (i < bytes.length) {
    const tag = varint()
    const type = tag & 7
    const field = Math.floor(tag / 8)
    if (type === 0) varint()
    else if (type === 1) i += 8
    else if (type === 5) i += 4
    else if (type === 2) {
      const length = varint()
      if (i + length > bytes.length) throw new Error("truncated protobuf")
      if (field === number) out.push(bytes.subarray(i, i + length))
      i += length
    } else throw new Error(`protobuf wire type ${type}`)
  }
  return out
}

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"

import { config } from "./config"
import { db } from "./db"

// Pictures of places come from other sites at any size. This serves each one
// at two widths, a blurry 24px stand-in and an 800px picture, both WebP, and
// keeps them on disk so a shop's site is asked once.

/** The widths the page asks for: the stand-in and the picture. */
export const WIDTHS = [24, 800] as const
export type Width = (typeof WIDTHS)[number]

const MAX_BYTES = 8 * 1024 * 1024
const USER_AGENT =
  "trip.zyx.tw (personal trip planner; https://github.com/zyx-tw/trip)"

const g = globalThis as unknown as {
  tripPhotos?: Map<string, Promise<Buffer | null>>
}
const loading = (g.tripPhotos ??= new Map())

/** True when some place lists this address as a photo, so the route fetches nothing else. */
function listed(url: string) {
  const rows = db()
    .prepare("select photos from places where instr(photos, ?) > 0")
    .all(JSON.stringify(url).slice(1, -1)) as { photos: string }[]
  return rows.some((r) => (JSON.parse(r.photos) as string[]).includes(url))
}

async function original(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  if (!res.headers.get("content-type")?.startsWith("image/"))
    throw new Error("not an image")
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > MAX_BYTES) throw new Error("image too large")
  return body
}

/** The picture at `width` as WebP, or null when no place lists `url`. */
export function photo(url: string, width: Width): Promise<Buffer | null> {
  const key = `${createHash("sha256").update(url).digest("hex")}-${width}`
  const pending = loading.get(key)
  if (pending) return pending
  const job = (async () => {
    if (!listed(url)) return null
    const dir = join(config().data, "photos")
    const file = join(dir, `${key}.webp`)
    try {
      return await readFile(file)
    } catch {
      // Not made yet.
    }
    const out = await sharp(await original(url))
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: width === 24 ? 50 : 78 })
      .toBuffer()
    await mkdir(dir, { recursive: true })
    await writeFile(file, out)
    return out
  })().finally(() => loading.delete(key))
  loading.set(key, job)
  return job
}

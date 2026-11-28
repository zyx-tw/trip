import { resolve } from "node:path"
import type { JWK } from "jose"
import authKey from "./auth-key.json"

export type Config = {
  data: string
  origin: string
  /** Where sign-in happens. */
  authOrigin: string
  /** auth.zyx.tw's public key, pinned in auth-key.json. */
  authKey: JWK
  /** The bearer token for MCP clients. MCP is off when unset. */
  token: string | null
  /**
   * A second bearer token that only reads: trips, photos, stations and routes.
   * For apps that keep a token on a phone, where the MCP token would be too much.
   */
  readToken: string | null
  /**
   * Development only: every request counts as signed in. Refused when
   * NODE_ENV is production, so a stray env var cannot open the real site.
   */
  openDev: boolean
}

let cached: Config | undefined

export function config(env: Record<string, string | undefined> = process.env): Config {
  if (cached) return cached
  const token = env.TRIP_TOKEN?.trim() || null
  if (token && token.length < 32) throw new Error("TRIP_TOKEN must be at least 32 characters")
  const readToken = env.TRIP_READ_TOKEN?.trim() || null
  if (readToken && readToken.length < 32) throw new Error("TRIP_READ_TOKEN must be at least 32 characters")
  if (readToken && readToken === token) throw new Error("TRIP_READ_TOKEN must differ from TRIP_TOKEN")
  const openDev = env.TRIP_OPEN_DEV === "1"
  if (openDev && env.NODE_ENV === "production") throw new Error("TRIP_OPEN_DEV is for development only")
  cached = {
    data: resolve(env.TRIP_DATA ?? "./data"),
    origin: (env.TRIP_ORIGIN ?? "http://localhost:3530").replace(/\/$/, ""),
    authOrigin: env.TRIP_AUTH_ORIGIN ?? "https://auth.zyx.tw",
    authKey: authKey as JWK,
    token,
    readToken,
    openDev,
  }
  return cached
}

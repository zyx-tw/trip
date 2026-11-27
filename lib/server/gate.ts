/**
 * Sign-in through auth.zyx.tw, for one service. Copy this file into the
 * service unchanged (the canonical copy lives in zyx-tw/auth/client/gate.ts).
 *
 * 1. `start()` sends the browser to auth.zyx.tw with a random state in a cookie.
 * 2. auth.zyx.tw posts a signed token back to `/auth/callback`.
 * 3. `callback()` checks the signature, audience, age, state and replay, and
 *    returns the auth session id. The service then makes its own session.
 * 4. `live(sid)` asks auth.zyx.tw whether that session still stands, so a
 *    sign-out or revoke there reaches the service.
 */
import { randomBytes } from "node:crypto"
import { type JWK, importJWK, jwtVerify } from "jose"

export type GateConfig = {
  /** https://auth.zyx.tw */
  authOrigin: string
  /** The service's id in auth's APPS, for example "ssh". */
  app: string
  /** The service's own origin; tokens must name it as audience. */
  origin: string
  /** auth's public key, pinned: `bun server/cli.ts key` on the auth host. */
  publicKey: JWK
  /** How long a live answer is reused. */
  liveCacheMs?: number
  /** How long a past "live" answer stands while auth cannot be reached. 0 fails closed at once. */
  liveGraceMs?: number
  /**
   * Marks a token id as used and returns false if it already was. Back it with
   * the service's database so a restart does not forget. Default: memory.
   */
  spend?: (jti: string, expiresAt: number) => boolean
}

export type Grant = { sid: string; authTime: number; expiresAt: number }

export class GateError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const STATE_COOKIE = "__Host-gate_state"
const MAX_TOKEN = 4096
const MAX_BODY = 8192

/** The form body, read up to MAX_BODY bytes, so an anonymous post cannot fill memory. */
async function readCapped(req: Request) {
  if (!(req.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) throw new GateError(415, "type")
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new GateError(413, "size")
  const chunks: Uint8Array[] = []
  let size = 0
  if (req.body) {
    for await (const chunk of req.body) {
      size += chunk.byteLength
      if (size > MAX_BODY) throw new GateError(413, "size")
      chunks.push(chunk)
    }
  }
  return Buffer.concat(chunks).toString("utf8")
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=")
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

export function createGate(config: GateConfig, fetcher: typeof fetch = fetch) {
  const key = importJWK(config.publicKey, "EdDSA")
  const cacheMs = config.liveCacheMs ?? 10_000
  const graceMs = config.liveGraceMs ?? 120_000
  /** Token ids already used, until they expire. */
  const used = new Map<string, number>()
  const spend =
    config.spend ??
    ((jti: string, expiresAt: number) => {
      const now = Date.now()
      for (const [id, exp] of used) if (exp < now) used.delete(id)
      if (used.has(jti)) return false
      used.set(jti, expiresAt)
      return true
    })
  const answers = new Map<string, { live: boolean; at: number; okAt: number }>()

  /** A redirect to auth.zyx.tw. The state cookie ties the answer to this browser. */
  function start(): Response {
    const state = randomBytes(24).toString("base64url")
    const location = `${config.authOrigin}/authorize?app=${encodeURIComponent(config.app)}&state=${state}`
    return new Response(null, {
      status: 302,
      headers: {
        location,
        "cache-control": "no-store",
        "set-cookie": `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
      },
    })
  }

  /** The Set-Cookie value that clears the state cookie; send it with the callback's answer. */
  const clearState = `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

  /** Checks the posted token. Throws GateError; never trust the body otherwise. */
  async function callback(req: Request): Promise<Grant> {
    if (req.method !== "POST") throw new GateError(405, "method")
    // auth.zyx.tw's page posts the form, so the browser names it as Origin.
    if (req.headers.get("origin") !== config.authOrigin) throw new GateError(403, "origin")
    const state = readCookie(req, STATE_COOKIE)
    if (!state) throw new GateError(400, "no state")
    const token = new URLSearchParams(await readCapped(req)).get("token")
    if (typeof token !== "string" || token.length > MAX_TOKEN) throw new GateError(400, "token")
    let payload
    try {
      ;({ payload } = await jwtVerify(token, await key, {
        issuer: config.authOrigin,
        audience: config.origin,
        algorithms: ["EdDSA"],
        maxTokenAge: "60s",
        clockTolerance: 5,
        requiredClaims: ["jti", "exp", "iat", "sid", "nonce", "auth_time", "sexp"],
      }))
    } catch {
      throw new GateError(403, "signature")
    }
    if (payload.nonce !== state) throw new GateError(403, "state")
    if (!spend(String(payload.jti), (payload.exp as number) * 1000 + 10_000)) throw new GateError(403, "replay")
    const { sid, auth_time, sexp } = payload as { sid: unknown; auth_time: unknown; sexp: unknown }
    if (typeof sid !== "string" || typeof auth_time !== "number" || typeof sexp !== "number") throw new GateError(403, "claims")
    return { sid, authTime: auth_time * 1000, expiresAt: sexp * 1000 }
  }

  /**
   * True while auth.zyx.tw says the session stands. A "no" counts at once. When
   * auth cannot be reached, the last "yes" holds for the grace period, then fails closed.
   */
  async function live(sid: string): Promise<boolean> {
    const now = Date.now()
    const last = answers.get(sid)
    if (last && now - last.at < cacheMs) return last.live
    try {
      const res = await fetcher(`${config.authOrigin}/api/live?sid=${encodeURIComponent(sid)}`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(String(res.status))
      const live = ((await res.json()) as { live?: unknown }).live === true
      if (answers.size > 1000) answers.clear()
      answers.set(sid, { live, at: now, okAt: now })
      return live
    } catch {
      const stands = !!last && last.live && now - last.okAt < graceMs
      answers.set(sid, { live: stands, at: now, okAt: last?.okAt ?? 0 })
      return stands
    }
  }

  return { start, callback, clearState, live }
}

export type Gate = ReturnType<typeof createGate>

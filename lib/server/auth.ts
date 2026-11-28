import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { config } from "./config"
import { db, spendToken } from "./db"
import { type Gate, GateError, createGate } from "./gate"

const SESSION_COOKIE = "trip_session"
// auth.zyx.tw asks for the passkey again after 7 days for trip (auth/server/apps.ts).
const SESSION_MS = 7 * 86_400_000

const sha256 = (value: string) => createHash("sha256").update(value).digest()

const g = globalThis as unknown as { tripGate?: Gate }

function gate(): Gate {
  const c = config()
  return (g.tripGate ??= createGate({ authOrigin: c.authOrigin, app: "trip", origin: c.origin, publicKey: c.authKey, spend: spendToken }))
}

function readCookie(header: string | null, name: string) {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=")
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

const cookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config().origin.startsWith("https:") ? "; Secure" : ""}`

/** True when the cookie header holds a live session here and auth.zyx.tw still holds the one behind it. */
export async function signedIn(cookieHeader: string | null): Promise<boolean> {
  if (config().openDev) return true
  const token = readCookie(cookieHeader, SESSION_COOKIE)
  if (!token || token.length > 128) return false
  const hash = sha256(token).toString("hex")
  const row = db().prepare("select sid, expires_at from sessions where token_hash = ?").get(hash) as { sid: string; expires_at: number } | undefined
  if (!row || row.expires_at <= Date.now()) return false
  if (await gate().live(row.sid)) return true
  db().prepare("delete from sessions where token_hash = ?").run(hash)
  return false
}

export const startSignIn = () => gate().start()

/** The answer to auth.zyx.tw's form post: a session here, then the app. */
export async function finishSignIn(req: Request): Promise<Response> {
  let grant
  try {
    grant = await gate().callback(req)
  } catch (error) {
    if (error instanceof GateError) return new Response(null, { status: error.status })
    throw error
  }
  const now = Date.now()
  if (grant.authTime < now - SESSION_MS) return new Response(null, { status: 403 })
  // 7 days from the passkey, not from this callback.
  const expires = Math.min(now + SESSION_MS, grant.authTime + SESSION_MS, grant.expiresAt)
  const token = randomBytes(32).toString("base64url")
  db().prepare("delete from sessions where expires_at < ?").run(now)
  db().prepare("insert into sessions (token_hash, sid, created_at, expires_at) values (?, ?, ?, ?)").run(sha256(token).toString("hex"), grant.sid, now, expires)
  const headers = new Headers({ location: "/", "cache-control": "no-store" })
  headers.append("set-cookie", cookie(token, Math.floor((expires - now) / 1000)))
  headers.append("set-cookie", gate().clearState)
  return new Response(null, { status: 303, headers })
}

export function signOut(cookieHeader: string | null): Response {
  const token = readCookie(cookieHeader, SESSION_COOKIE)
  if (token) db().prepare("delete from sessions where token_hash = ?").run(sha256(token).toString("hex"))
  return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie("", 0), "cache-control": "no-store" } })
}

function bearer(req: Request, expected: string | null): boolean {
  const header = req.headers.get("authorization")
  if (!expected || !header?.startsWith("Bearer ")) return false
  return timingSafeEqual(sha256(header.slice(7)), sha256(expected))
}

/** True when the request carries the MCP token. Only a header counts, never a cookie. */
export const hasToken = (req: Request) => bearer(req, config().token)

/** True when the request may read: a signed-in page, the MCP token, or the read-only token. */
export async function canRead(req: Request): Promise<boolean> {
  return bearer(req, config().token) || bearer(req, config().readToken) || (await signedIn(req.headers.get("cookie")))
}

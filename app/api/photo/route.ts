import { hasToken, signedIn } from "@/lib/server/auth"
import { photo, type Width, WIDTHS } from "@/lib/server/photos"

/** A place's photo, resized: /api/photo?u=<address>&w=24 or 800. */
export async function GET(req: Request) {
  if (!hasToken(req) && !(await signedIn(req.headers.get("cookie"))))
    return new Response(null, { status: 401 })
  const params = new URL(req.url).searchParams
  const url = params.get("u") ?? ""
  const width = Number(params.get("w")) as Width
  if (!url.startsWith("https://") || !WIDTHS.includes(width))
    return new Response(null, { status: 400 })
  try {
    const body = await photo(url, width)
    if (!body) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "private, max-age=31536000, immutable",
      },
    })
  } catch {
    // The shop's site is down or sent something that is not a picture.
    return new Response(null, { status: 502 })
  }
}

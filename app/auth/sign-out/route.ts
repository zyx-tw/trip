import { signOut } from "@/lib/server/auth"
import { config } from "@/lib/server/config"

// Only this site's own form may sign out; another zyx.tw subdomain counts as same-site.
export function POST(req: Request) {
  if (req.headers.get("origin") !== config().origin) return new Response(null, { status: 403 })
  return signOut(req.headers.get("cookie"))
}

import { hasToken } from "@/lib/server/auth"
import { handleMcp } from "@/lib/server/mcp"

// Machines only: the bearer token, never a cookie, so a page cannot drive MCP.
export async function POST(req: Request) {
  if (!hasToken(req)) return new Response(null, { status: 401, headers: { "www-authenticate": "Bearer" } })
  return handleMcp(req)
}

export function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } })
}

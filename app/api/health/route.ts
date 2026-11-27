import { db } from "@/lib/server/db"

export function GET() {
  db().prepare("select 1").get()
  return new Response("ok", { headers: { "cache-control": "no-store" } })
}

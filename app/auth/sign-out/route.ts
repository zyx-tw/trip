import { signOut } from "@/lib/server/auth"

export function POST(req: Request) {
  return signOut(req.headers.get("cookie"))
}

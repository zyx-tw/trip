import { startSignIn } from "@/lib/server/auth"

export function GET() {
  return startSignIn()
}

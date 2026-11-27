import { finishSignIn } from "@/lib/server/auth"

// auth.zyx.tw posts the signed token here; the gate checks Origin, state and replay.
export function POST(req: Request) {
  return finishSignIn(req)
}

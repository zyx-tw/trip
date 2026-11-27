import { BottomCorners, LegalLinks, TopCorners } from "./corners"
import { Button } from "./ui/button"

/** The sign-in screen: the title and one button, centered in the viewport. */
export function SignIn() {
  return (
    <>
      <TopCorners fade />
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-(--gutter)">
        <h1 className="text-title font-medium">旅行</h1>
        {/* A route handler, not a page: a plain link, so nothing prefetches it. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <Button render={<a href="/auth/start" />}>登入</Button>
      </main>
      <BottomCorners fade links={<LegalLinks />} />
    </>
  )
}

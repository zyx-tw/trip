import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { SignIn } from "@/components/sign-in"
import { TripView } from "@/components/trip-view"
import { signedIn } from "@/lib/server/auth"
import { getTrip } from "@/lib/server/trips"

export const metadata: Metadata = { title: "旅行" }

export default async function Page({ params }: PageProps<"/[trip]">) {
  if (!(await signedIn((await headers()).get("cookie")))) return <SignIn />
  const trip = getTrip((await params).trip)
  if (!trip) notFound()
  return <TripView initial={trip} />
}

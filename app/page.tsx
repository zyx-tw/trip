import { headers } from "next/headers"
import Link from "next/link"

import { SignIn } from "@/components/sign-in"
import { TaskShell } from "@/components/task-shell"
import { signedIn } from "@/lib/server/auth"
import { listTrips } from "@/lib/server/trips"
import { formatRange } from "@/lib/dates"

export default async function Page() {
  if (!(await signedIn((await headers()).get("cookie")))) return <SignIn />
  const trips = listTrips()
  return (
    <TaskShell title="旅行">
      <ul className="flex flex-col">
        {trips.map((trip) => (
          <li key={trip.id}>
            <Link
              href={`/${trip.id}`}
              className="flex items-baseline justify-between gap-4 py-2 hover:text-muted-foreground"
            >
              <span>{trip.title}</span>
              <span className="text-caption text-muted-foreground">
                {formatRange(trip.startDate, trip.endDate)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </TaskShell>
  )
}

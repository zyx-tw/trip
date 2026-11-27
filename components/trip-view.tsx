"use client"

import dynamic from "next/dynamic"
import { Fragment, useEffect, useMemo, useState } from "react"

import { TaskShell } from "@/components/task-shell"
import { country } from "@/lib/countries"
import { daysOf, formatDay, formatRange } from "@/lib/dates"
import { CATEGORY_LABEL, type Leg, type Place, type TripWithPlaces } from "@/lib/types"
import { cn } from "@/lib/utils"

import type { Line, Pin } from "./trip-map"

const TripMap = dynamic(() => import("./trip-map").then((m) => m.TripMap), {
  ssr: false,
  loading: () => <div className="h-[55dvh] w-full bg-muted" />,
})

// One hue per day, so a pin's color says which day it belongs to. Candidates stay gray.
const DAY_HUES = [25, 145, 250, 75, 310, 190, 0, 110, 280, 50]
const dayColor = (index: number) => `oklch(0.72 0.15 ${DAY_HUES[index % DAY_HUES.length]})`
const CANDIDATE = "oklch(0.6 0 0)"

type Group = { day: string | null; color: string; places: Place[] }

export function TripView({ initial }: { initial: TripWithPlaces }) {
  const [trip, setTrip] = useState(initial)
  const [selected, setSelected] = useState<string | null>(null)
  const [legs, setLegs] = useState<Leg[]>([])

  // A write through MCP sends "change"; refetch the trip and its routes then.
  useEffect(() => {
    let live = true
    const loadLegs = async () => {
      const res = await fetch(`/api/trips/${initial.id}/legs`, { cache: "no-store" })
      if (res.ok && live) setLegs(await res.json())
    }
    const reload = async () => {
      const res = await fetch(`/api/trips/${initial.id}`, { cache: "no-store" })
      if (res.ok && live) setTrip(await res.json())
      loadLegs()
    }
    loadLegs()
    const source = new EventSource(`/api/trips/${initial.id}/events`)
    source.addEventListener("change", reload)
    return () => {
      live = false
      source.close()
    }
  }, [initial.id])

  const legTo = useMemo(() => new Map(legs.map((l) => [l.to, l])), [legs])

  const groups = useMemo<Group[]>(() => {
    const days = daysOf(trip.startDate, trip.endDate)
    const out: Group[] = days.map((day, i) => ({ day, color: dayColor(i), places: trip.places.filter((p) => p.day === day) }))
    out.push({ day: null, color: CANDIDATE, places: trip.places.filter((p) => !p.day) })
    return out.filter((g) => g.places.length > 0)
  }, [trip])

  const pins = useMemo<Pin[]>(
    () => groups.flatMap((g) => g.places.map((p, i) => ({ ...p, label: g.day ? String(i + 1) : "", color: g.color }))),
    [groups],
  )

  const lines = useMemo<Line[]>(() => {
    const colorOf = new Map(groups.flatMap((g) => g.places.map((p) => [p.id, g.color] as const)))
    return legs.filter((l) => l.line).map((l) => ({ id: `${l.from}-${l.to}`, color: colorOf.get(l.to) ?? CANDIDATE, points: l.line! }))
  }, [legs, groups])

  const c = country(trip.country)

  function choose(id: string) {
    setSelected(id)
    document.getElementById(`place-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }

  return (
    <TaskShell title={trip.title} description={formatRange(trip.startDate, trip.endDate)} wide>
      <TripMap pins={pins} lines={lines} selected={selected} onSelect={choose} />
      {groups.map((group) => (
        <section key={group.day ?? "candidates"} className="mt-12" aria-label={group.day ? formatDay(group.day) : "候選"}>
          <h2 className="flex items-center gap-3 text-title font-medium">
            <span aria-hidden className="size-3" style={{ background: group.color }} />
            {group.day ? formatDay(group.day) : "候選"}
          </h2>
          <ol className="mt-4 flex flex-col">
            {group.places.map((place, i) => (
              <Fragment key={place.id}>
              {group.day && legTo.get(place.id) && <LegRow leg={legTo.get(place.id)!} />}
              <li
                key={place.id}
                id={`place-${place.id}`}
                className={cn("scroll-mt-24 border-t border-border py-4", selected === place.id && "bg-muted")}
                // Tapping the row shows the place on the map; the links below work on their own.
                onClick={() => setSelected(place.id)}
              >
                <div className="flex w-full cursor-pointer gap-4">
                  <span className="w-6 shrink-0 text-muted-foreground">{group.day ? i + 1 : ""}</span>
                  <span className="flex min-w-0 flex-col">
                    <span lang="ja">{place.name}</span>
                    {place.nameZh && <span className="text-muted-foreground">{place.nameZh}</span>}
                    <span className="text-caption text-muted-foreground">
                      {place.time ? `${place.time}，${CATEGORY_LABEL[place.category]}` : CATEGORY_LABEL[place.category]}
                    </span>
                    {place.note && <span className="mt-2 text-caption whitespace-pre-line">{place.note}</span>}
                  </span>
                </div>
                <div className="mt-3 ml-10 flex flex-wrap gap-x-4 gap-y-1 text-caption">
                  {c.placeLinks(place).map((link) => (
                    <a key={link.label} href={link.url} target="_blank" rel="noreferrer" className="py-2 text-muted-foreground hover:text-foreground">
                      {link.label}
                    </a>
                  ))}
                  {c.routeLinks(place).map((link) => (
                    <a key={`route-${link.label}`} href={link.url} target="_blank" rel="noreferrer" className="py-2 text-muted-foreground hover:text-foreground">
                      {link.label} 路線
                    </a>
                  ))}
                </div>
              </li>
              </Fragment>
            ))}
          </ol>
        </section>
      ))}
    </TaskShell>
  )
}

/** How to get from the place above to the one below: a walk, or the rides of a transit trip. */
function LegRow({ leg }: { leg: Leg }) {
  if (leg.mode === "walk") {
    return (
      <p className="ml-10 py-2 text-caption text-muted-foreground">
        走路 {leg.minutes} 分，{leg.meters} 公尺
      </p>
    )
  }
  return (
    <div className="ml-10 flex flex-col py-2 text-caption text-muted-foreground">
      <span>交通 {leg.minutes} 分</span>
      {leg.rides?.map((r, i) => (
        <span key={i} lang="ja">
          {r.departs} {r.from} 搭 {r.name} 往 {r.headsign}，{r.arrives} 到 {r.to}
        </span>
      ))}
    </div>
  )
}

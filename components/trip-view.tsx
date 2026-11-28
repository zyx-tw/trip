"use client"

import dynamic from "next/dynamic"
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import { TopCorners } from "@/components/corners"
import { FrameEdges } from "@/components/ui/frame"
import { Input } from "@/components/ui/input"
import { preloadPhotos } from "@/components/photo"
import { CARD_PX, PlaceCarousel } from "@/components/place-carousel"
import { PlaceDetail, PlaceLinks } from "@/components/place-detail"
import { country } from "@/lib/countries"
import { daysOf, formatDay, formatRange } from "@/lib/dates"
import { matches } from "@/lib/search"
import { CATEGORY_EMOJI, type Leg, type TripWithPlaces } from "@/lib/types"
import { cn } from "@/lib/utils"

import type { Line, Pin } from "./trip-map"

const TripMap = dynamic(() => import("./trip-map").then((m) => m.TripMap), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-muted" />,
})

// One hue per day, so a route's color says which day it belongs to.
const DAY_HUES = [25, 145, 250, 75, 310, 190, 0, 110, 280, 50]
const dayColor = (index: number) =>
  `oklch(0.72 0.15 ${DAY_HUES[index % DAY_HUES.length]})`
const CANDIDATE = "oklch(0.6 0 0)"

export function TripView({ initial }: { initial: TripWithPlaces }) {
  const [trip, setTrip] = useState(initial)
  const [selected, setSelected] = useState<string | null>(null)
  const [legs, setLegs] = useState<Leg[]>([])
  /** On a phone: the centered card pulled up (true) or resting low (false). */
  const [open, setOpen] = useState(false)
  const wide = useWide()
  const [query, setQuery] = useState("")

  // A write through MCP sends "change"; refetch the trip and its routes then.
  useEffect(() => {
    let live = true
    const loadLegs = async () => {
      const res = await fetch(`/api/trips/${initial.id}/legs`, {
        cache: "no-store",
      })
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

  // Fetch every picture while the page is idle, so a row opens with its photos ready.
  useEffect(() => {
    const urls = trip.places.flatMap((p) => p.photos)
    if (urls.length === 0) return
    const idle =
      window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200))
    idle(() => preloadPhotos(urls))
  }, [trip.places])

  /** The leg that reaches a place on a day, by "day:place". */
  const legTo = useMemo(
    () => new Map(legs.map((l) => [`${l.day}:${l.to}`, l])),
    [legs]
  )
  const nameOf = useMemo(
    () => new Map(trip.places.map((p) => [p.id, p.nameZh || p.name])),
    [trip.places]
  )

  const days = useMemo(
    () => daysOf(trip.startDate, trip.endDate),
    [trip.startDate, trip.endDate]
  )

  const filtering = query.trim() !== ""
  // Planned places by day and order, then the ones with no day yet.
  const ordered = useMemo(
    () =>
      [...trip.places].sort(
        (a, b) =>
          Number((a.day ?? "~") > (b.day ?? "~")) -
            Number((a.day ?? "~") < (b.day ?? "~")) || a.position - b.position
      ),
    [trip.places]
  )
  const visible = useMemo(
    () =>
      ordered.filter((p) => matches(p, query, p.day ? formatDay(p.day) : "")),
    [ordered, query]
  )

  const pins = useMemo<Pin[]>(
    () =>
      visible.map((p) => ({
        ...p,
        emoji: CATEGORY_EMOJI[p.category],
      })),
    [visible]
  )

  // Walks and rides join a day's places in order, so they hide while filtering.
  const lines = useMemo<Line[]>(() => {
    if (filtering) return []
    const index = new Map(days.map((d, i) => [d, i]))
    return legs
      .filter((l) => l.line)
      .map((l) => ({
        id: `${l.day}-${l.from}-${l.to}`,
        color: index.has(l.day) ? dayColor(index.get(l.day)!) : CANDIDATE,
        points: l.line!,
      }))
  }, [legs, days, filtering])

  const c = country(trip.country)

  function choose(id: string) {
    setSelected(id)
    document
      .getElementById(`place-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }

  // The part of the map the panel covers, so pins land in the visible part.
  const padding = wide
    ? { left: 440, top: 60, right: 60, bottom: 60 }
    : { left: 24, top: 60, right: 24, bottom: CARD_PX + 48 }

  return (
    <>
      <div className="fixed inset-0">
        <TripMap
          pins={pins}
          lines={lines}
          selected={selected}
          onSelect={choose}
          padding={padding}
        />
      </div>
      {/* No bottom corners here: the owner wants the map clear to the edge. */}
      <TopCorners
        trail={[{ label: "旅行", href: "/" }, { label: trip.title }]}
      />
      {wide ? (
        <aside
          aria-label="行程"
          className={cn(
            "fixed top-[calc(var(--gutter)+2.5rem)] bottom-(--gutter) left-(--gutter) z-10 flex w-100 flex-col overflow-hidden rounded-control bg-background/70 shadow-window backdrop-blur-md"
          )}
        >
          <FrameEdges />
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-16">
            <h1 className="text-title font-medium tracking-tight">{trip.title}</h1>
            <p className="mt-1 text-muted-foreground">
              {formatRange(trip.startDate, trip.endDate)}
            </p>
            <Input
              type="search"
              aria-label="搜尋"
              placeholder="搜尋"
              className="mt-5"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {visible.length === 0 && (
              <p className="mt-10 text-muted-foreground">沒有符合的地點</p>
            )}
            <ol className="mt-6 flex flex-col">
              {visible.map((place, i) => {
                const before = visible[i - 1]
                const after = visible[i + 1]
                // The way here: from the place above, or from the night's stay.
                const leg =
                  !filtering && place.day
                    ? legTo.get(`${place.day}:${place.id}`)
                    : undefined
                // After the day's last place: the way back to the night's stay.
                const home =
                  !filtering && place.day && after?.day !== place.day
                    ? legs.find((l) => l.day === place.day && l.from === place.id)
                    : undefined
                const links = [...c.placeLinks(place), ...place.pages]
                return (
                  <Fragment key={place.id}>
                    {leg && (
                      <LegRow
                        leg={leg}
                        from={
                          before?.id === leg.from
                            ? undefined
                            : nameOf.get(leg.from)
                        }
                      />
                    )}
                    <li
                      id={`place-${place.id}`}
                      aria-current={selected === place.id ? "true" : undefined}
                      className={cn(
                        // The row's color runs to the panel's edges.
                        "-mx-5 flex cursor-pointer scroll-mt-24 gap-3 border-t border-border px-5 py-4 hover:bg-muted/40",
                        selected === place.id && "bg-muted/70 hover:bg-muted/70"
                      )}
                      // Tapping a row opens it and shows the place; tapping it again closes it.
                      onClick={() =>
                        setSelected((v) => (v === place.id ? null : place.id))
                      }
                    >
                      <span aria-hidden className="w-6 shrink-0">
                        {CATEGORY_EMOJI[place.category]}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span lang="ja">{place.name}</span>
                        {place.nameZh && (
                          <span className="text-muted-foreground">
                            {place.nameZh}
                          </span>
                        )}
                        {place.day && (
                          <span className="text-caption text-muted-foreground">
                            {[formatDay(place.day), place.time]
                              .filter(Boolean)
                              .join(" ")}
                          </span>
                        )}
                        <span
                          className={cn(
                            "grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300",
                            selected === place.id
                              ? "grid-rows-[1fr]"
                              : "grid-rows-[0fr]"
                          )}
                        >
                          <span className="flex min-h-0 flex-col overflow-hidden">
                            {selected === place.id && (
                              <PlaceDetail place={place} links={links} />
                            )}
                          </span>
                        </span>
                      </span>
                    </li>
                    {home && <LegRow leg={home} to={nameOf.get(home.to)} />}
                  </Fragment>
                )
              })}
            </ol>
          </div>
        </aside>
      ) : (
        <div className="fixed inset-x-0 bottom-(--gutter) z-10">
          <PlaceCarousel
            places={ordered}
            selected={selected}
            onSelect={(id) => {
              setOpen(false)
              setSelected(id)
            }}
            open={open}
            onToggle={() => setOpen((v) => !v)}
            render={(place, opened) => (
              <PlaceCard
                place={place}
                open={opened}
                leg={
                  place.day ? legTo.get(`${place.day}:${place.id}`) : undefined
                }
                links={[...c.placeLinks(place), ...place.pages]}
              />
            )}
          />
        </div>
      )}
    </>
  )
}

/** True on screens wide enough for the side panel (Tailwind lg). The server renders the phone layout. */
const WIDE = "(min-width: 1024px)"
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE)
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    },
    () => window.matchMedia(WIDE).matches,
    () => false
  )
}

/** How to get from the place above to the one below: a walk, or the rides of a transit trip. */
function LegRow({ leg, from, to }: { leg: Leg; from?: string; to?: string }) {
  // A leg out of the stay names where it starts; the leg back names where it ends.
  const where = from ? `從 ${from} ` : to ? `回 ${to} ` : ""
  if (leg.mode === "walk") {
    return (
      <p className="ml-9 py-2 text-caption text-muted-foreground">
        {where}走路 {leg.minutes} 分，{leg.meters} 公尺
      </p>
    )
  }
  return (
    <div className="ml-9 flex flex-col py-2 text-caption text-muted-foreground">
      <span>
        {where}交通 {leg.minutes} 分
      </span>
      {leg.rides?.map((r, i) => (
        <span key={i} lang="ja">
          {r.departs} {r.from} 搭 {r.name} 往 {r.headsign}，{r.arrives} 到{" "}
          {r.to}
        </span>
      ))}
    </div>
  )
}

/** A place on its phone card: names and day, then its photos and note when pulled up. */
function PlaceCard({
  place,
  open,
  leg,
  links,
}: {
  place: TripWithPlaces["places"][number]
  open: boolean
  leg?: Leg
  links: { label: string; url: string }[]
}) {
  return (
    <span className="flex min-w-0 gap-3">
      <span aria-hidden className="w-6 shrink-0">
        {CATEGORY_EMOJI[place.category]}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span lang="ja" className="truncate">
          {place.name}
        </span>
        {place.nameZh && (
          <span className="truncate text-muted-foreground">
            {place.nameZh}
          </span>
        )}
        {place.day && (
          <span className="text-caption text-muted-foreground">
            {[formatDay(place.day), place.time].filter(Boolean).join(" ")}
          </span>
        )}
        {leg && (
          <span className="text-caption text-muted-foreground">
            {leg.mode === "walk" ? "走路" : "交通"} {leg.minutes} 分
          </span>
        )}
        {open ? (
          <PlaceDetail place={place} links={links} />
        ) : (
          links.length > 0 && <PlaceLinks links={links} />
        )}
      </span>
    </span>
  )
}

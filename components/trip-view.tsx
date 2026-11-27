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
import { Photo, preloadPhotos } from "@/components/photo"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { country } from "@/lib/countries"
import { daysOf, formatDay, formatRange } from "@/lib/dates"
import { matches } from "@/lib/search"
import {
  CATEGORY_EMOJI,
  type Leg,
  type Place,
  type TripWithPlaces,
} from "@/lib/types"
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
  /** On a phone: the list sheet pulled up (true) or resting low (false). */
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

  const legTo = useMemo(() => new Map(legs.map((l) => [l.to, l])), [legs])

  const days = useMemo(
    () => daysOf(trip.startDate, trip.endDate),
    [trip.startDate, trip.endDate]
  )
  /** Each place's color: its day's, or gray while it is a candidate. */
  const colorOf = useMemo(() => {
    const index = new Map(days.map((d, i) => [d, i]))
    return (p: Place) =>
      p.day && index.has(p.day) ? dayColor(index.get(p.day)!) : CANDIDATE
  }, [days])

  const filtering = query.trim() !== ""
  // Planned places by day and order, then the ones with no day yet.
  const ordered = useMemo(
    () =>
      [...trip.places].sort(
        (a, b) =>
          (a.day ?? "~").localeCompare(b.day ?? "~") || a.position - b.position
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
    const byId = new Map(trip.places.map((p) => [p.id, p]))
    return legs
      .filter((l) => l.line)
      .map((l) => ({
        id: `${l.from}-${l.to}`,
        color: byId.has(l.to) ? colorOf(byId.get(l.to)!) : CANDIDATE,
        points: l.line!,
      }))
  }, [legs, trip.places, colorOf, filtering])

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
    : { left: 24, top: 60, right: 24, bottom: open ? 0 : SHEET_LOW_PX + 24 }

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
        nav={<ThemeToggle />}
      />
      <aside
        aria-label="行程"
        className={cn(
          "fixed z-10 flex flex-col border-muted-foreground bg-background/70 backdrop-blur-md motion-safe:transition-[height] motion-safe:duration-300",
          // Phone: a sheet along the bottom. Wide screens: a panel on the left.
          "inset-x-0 bottom-0 border-t",
          open ? "h-[85dvh]" : "h-(--sheet-low)",
          "lg:top-[calc(var(--gutter)+2.5rem)] lg:bottom-(--gutter) lg:left-(--gutter) lg:h-auto lg:w-100 lg:border-t-0"
        )}
        style={{ "--sheet-low": `${SHEET_LOW_PX}px` } as React.CSSProperties}
      >
        {/* On wide screens the panel is framed like the search box. */}
        <FrameEdges className="max-lg:hidden" />
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "收合" : "展開"}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 shrink-0 items-center justify-center lg:hidden"
        >
          <span aria-hidden className="h-1 w-10 bg-muted-foreground" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-16 lg:pt-5">
          <h1 className="text-title font-medium">{trip.title}</h1>
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
              const leg =
                !filtering && before?.day && before.day === place.day
                  ? legTo.get(place.id)
                  : undefined
              const links = [...c.placeLinks(place), ...place.pages]
              return (
                <Fragment key={place.id}>
                  {leg && <LegRow leg={leg} />}
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
                          {selected === place.id && place.photos.length > 0 && (
                            // Each picture fills the row's width; swipe or scroll sideways for the next.
                            <span className="mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto">
                              {place.photos.map((src) => (
                                <Photo
                                  key={src}
                                  url={src}
                                  className={cn(
                                    "aspect-[3/2] shrink-0 snap-start",
                                    // With more than one, the next one peeks in from the right.
                                    place.photos.length > 1
                                      ? "w-[88%]"
                                      : "w-full"
                                  )}
                                />
                              ))}
                            </span>
                          )}
                          {place.note && (
                            <span className="mt-3 text-caption whitespace-pre-line">
                              {place.note}
                            </span>
                          )}
                          {place.address && (
                            <span
                              lang="ja"
                              className="mt-2 text-caption text-muted-foreground"
                            >
                              {place.address}
                            </span>
                          )}
                          {links.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-x-4 text-caption">
                              {links.map((link) => (
                                <a
                                  key={link.label}
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="py-2 text-muted-foreground hover:text-foreground"
                                >
                                  {link.label}
                                </a>
                              ))}
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                  </li>
                </Fragment>
              )
            })}
          </ol>
        </div>
      </aside>
    </>
  )
}

/** Height of the phone sheet at rest: the title, the dates, the search and the first place. */
const SHEET_LOW_PX = 300

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
function LegRow({ leg }: { leg: Leg }) {
  if (leg.mode === "walk") {
    return (
      <p className="ml-9 py-2 text-caption text-muted-foreground">
        走路 {leg.minutes} 分，{leg.meters} 公尺
      </p>
    )
  }
  return (
    <div className="ml-9 flex flex-col py-2 text-caption text-muted-foreground">
      <span>交通 {leg.minutes} 分</span>
      {leg.rides?.map((r, i) => (
        <span key={i} lang="ja">
          {r.departs} {r.from} 搭 {r.name} 往 {r.headsign}，{r.arrives} 到{" "}
          {r.to}
        </span>
      ))}
    </div>
  )
}

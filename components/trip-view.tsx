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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { country } from "@/lib/countries"
import { daysOf, formatDay, formatRange } from "@/lib/dates"
import { matches } from "@/lib/search"
import {
  CATEGORIES,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  type Category,
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

// One hue per day, so a pin's color says which day it belongs to. Candidates stay gray.
const DAY_HUES = [25, 145, 250, 75, 310, 190, 0, 110, 280, 50]
const dayColor = (index: number) =>
  `oklch(0.72 0.15 ${DAY_HUES[index % DAY_HUES.length]})`
const CANDIDATE = "oklch(0.6 0 0)"

type Group = {
  key: string
  title: string
  /** The day's color; none when the list is grouped by category. */
  color?: string
  /** Numbered and joined by walks and rides: the places of one day, unfiltered. */
  route: boolean
  places: Place[]
}

const CATEGORY_ITEMS = [
  { value: "all", label: "全部分類" },
  ...CATEGORIES.map((c) => ({
    value: c,
    label: `${CATEGORY_EMOJI[c]} ${CATEGORY_LABEL[c]}`,
  })),
]
const GROUP_ITEMS = [
  { value: "day", label: "依日期" },
  { value: "category", label: "依分類" },
]

export function TripView({ initial }: { initial: TripWithPlaces }) {
  const [trip, setTrip] = useState(initial)
  const [selected, setSelected] = useState<string | null>(null)
  const [legs, setLegs] = useState<Leg[]>([])
  /** On a phone: the list sheet pulled up (true) or resting low (false). */
  const [open, setOpen] = useState(false)
  const wide = useWide()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<Category | "all">("all")
  const [groupBy, setGroupBy] = useState<"day" | "category">("day")

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

  const filtering = query.trim() !== "" || category !== "all"
  const visible = useMemo(
    () =>
      trip.places.filter(
        (p) =>
          (category === "all" || p.category === category) && matches(p, query)
      ),
    [trip.places, query, category]
  )

  const groups = useMemo<Group[]>(() => {
    const out: Group[] =
      groupBy === "day"
        ? [
            ...days.map((day, i) => ({
              key: day,
              title: formatDay(day),
              color: dayColor(i),
              route: !filtering,
              places: visible.filter((p) => p.day === day),
            })),
            {
              key: "candidates",
              title: "候選",
              color: CANDIDATE,
              route: false,
              places: visible.filter((p) => !p.day),
            },
          ]
        : CATEGORIES.map((c) => ({
            key: c,
            title: `${CATEGORY_EMOJI[c]} ${CATEGORY_LABEL[c]}`,
            route: false,
            places: visible.filter((p) => p.category === c),
          }))
    return out.filter((g) => g.places.length > 0)
  }, [days, visible, groupBy, filtering])

  const pins = useMemo<Pin[]>(
    () =>
      visible.map((p) => ({
        ...p,
        emoji: CATEGORY_EMOJI[p.category],
        color: colorOf(p),
      })),
    [visible, colorOf]
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
          "fixed z-10 flex flex-col border border-muted-foreground bg-background motion-safe:transition-[height] motion-safe:duration-300",
          // Phone: a sheet along the bottom. Wide screens: a panel on the left.
          "inset-x-0 bottom-0 border-x-0 border-b-0",
          open ? "h-[85dvh]" : "h-(--sheet-low)",
          "lg:top-[calc(var(--gutter)+2.5rem)] lg:bottom-(--gutter) lg:left-(--gutter) lg:h-auto lg:w-100 lg:border-x lg:border-b"
        )}
        style={{ "--sheet-low": `${SHEET_LOW_PX}px` } as React.CSSProperties}
      >
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
          <div className="mt-5 flex flex-col gap-2">
            <Input
              type="search"
              aria-label="搜尋"
              placeholder="搜尋"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <Select
                items={CATEGORY_ITEMS}
                value={category}
                onValueChange={(v) => setCategory(v as Category | "all")}
              >
                <SelectTrigger aria-label="分類" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                items={GROUP_ITEMS}
                value={groupBy}
                onValueChange={(v) => setGroupBy(v as "day" | "category")}
              >
                <SelectTrigger aria-label="分組" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {groups.length === 0 && (
            <p className="mt-10 text-muted-foreground">沒有符合的地點</p>
          )}
          {groups.map((group) => (
            <section key={group.key} className="mt-10" aria-label={group.title}>
              <h2 className="flex items-center gap-3 text-title font-medium">
                {group.color && (
                  <span
                    aria-hidden
                    className="size-3"
                    style={{ background: group.color }}
                  />
                )}
                {group.title}
              </h2>
              <ol className="mt-4 flex flex-col">
                {group.places.map((place, i) => (
                  <Fragment key={place.id}>
                    {group.route && legTo.get(place.id) && (
                      <LegRow leg={legTo.get(place.id)!} />
                    )}
                    <li
                      key={place.id}
                      id={`place-${place.id}`}
                      className={cn(
                        "scroll-mt-24 border-t border-border py-4",
                        selected === place.id && "bg-muted"
                      )}
                      // Tapping the row shows the place on the map; the links below work on their own.
                      onClick={() => setSelected(place.id)}
                    >
                      <div className="flex w-full cursor-pointer gap-4">
                        <span className="w-6 shrink-0 text-muted-foreground">
                          {group.route ? i + 1 : ""}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span lang="ja">
                            <span aria-hidden className="mr-2">
                              {CATEGORY_EMOJI[place.category]}
                            </span>
                            {place.name}
                          </span>
                          {place.nameZh && (
                            <span className="text-muted-foreground">
                              {place.nameZh}
                            </span>
                          )}
                          {place.time && (
                            <span className="text-caption text-muted-foreground">
                              {place.time}
                            </span>
                          )}
                          {place.note && (
                            <span className="mt-2 text-caption whitespace-pre-line">
                              {place.note}
                            </span>
                          )}
                        </span>
                      </div>
                      {c.placeLinks(place).length > 0 && (
                        <div className="mt-3 ml-10 flex flex-wrap gap-x-4 gap-y-1 text-caption">
                          {c.placeLinks(place).map((link) => (
                            <a
                              key={link.label}
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              className="py-2 text-muted-foreground hover:text-foreground"
                            >
                              {link.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                  </Fragment>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </aside>
    </>
  )
}

/** Height of the phone sheet at rest: the title, the dates, the search and the first day. */
const SHEET_LOW_PX = 340

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
          {r.departs} {r.from} 搭 {r.name} 往 {r.headsign}，{r.arrives} 到{" "}
          {r.to}
        </span>
      ))}
    </div>
  )
}

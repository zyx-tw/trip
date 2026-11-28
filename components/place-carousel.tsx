"use client"

import { useEffect, useLayoutEffect, useRef } from "react"

import type { Place } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Height of a closed card, which the map keeps clear at the bottom. */
export const CARD_PX = 168

/** How long the track sits still before a swipe counts as done. */
const SETTLE_MS = 120

/**
 * The phone's places: one card each along the bottom, swiped sideways.
 * The row loops: past the last place comes the first again. It renders the
 * places three times and, once a swipe settles, jumps back to the middle copy.
 */
export function PlaceCarousel({
  places,
  selected,
  onSelect,
  open,
  onToggle,
  render,
}: {
  places: Place[]
  selected: string | null
  onSelect: (id: string) => void
  /** The centered card pulled up to show its photos and note. */
  open: boolean
  onToggle: () => void
  render: (place: Place, open: boolean) => React.ReactNode
}) {
  const track = useRef<HTMLOListElement>(null)
  const n = places.length
  const loop = n > 1
  const copies = loop ? [0, 1, 2] : [0]
  const middle = loop ? n : 0
  /** Set while the page itself scrolls the track, so that scroll picks nothing. */
  const programmatic = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const current = useRef(0)

  const cards = () =>
    Array.from(track.current?.children ?? []) as HTMLElement[]

  function center(index: number, smooth: boolean) {
    const t = track.current
    const card = cards()[index]
    if (!t || !card) return
    t.scrollTo({
      left: card.offsetLeft - (t.clientWidth - card.offsetWidth) / 2,
      behavior: smooth ? "smooth" : "instant",
    })
  }

  function nearest() {
    const t = track.current
    if (!t) return 0
    const mid = t.scrollLeft + t.clientWidth / 2
    let best = 0
    let gap = Infinity
    cards().forEach((card, i) => {
      const d = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid)
      if (d < gap) {
        gap = d
        best = i
      }
    })
    return best
  }

  // Start on the selected place, or the first one, in the middle copy.
  useLayoutEffect(() => {
    const i = Math.max(
      0,
      places.findIndex((p) => p.id === selected)
    )
    current.current = i
    programmatic.current = true
    center(middle + i, false)
    // Only when the places change; a pick re-centers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, middle])

  // A pin tapped on the map brings its card to the center.
  useEffect(() => {
    if (!selected) return
    const i = places.findIndex((p) => p.id === selected)
    if (i < 0 || i === current.current) return
    current.current = i
    programmatic.current = true
    center(middle + i, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  function settle() {
    if (n === 0) return
    const at = nearest()
    const i = at % n
    // Out in the first or last copy: jump to the same card in the middle one.
    if (loop && Math.floor(at / n) !== 1) center(middle + i, false)
    const byHand = !programmatic.current
    programmatic.current = false
    if (i === current.current && !byHand) return
    current.current = i
    if (byHand && places[i].id !== selected) onSelect(places[i].id)
  }

  return (
    <ol
      ref={track}
      aria-label="地點"
      onScroll={() => {
        clearTimeout(timer.current)
        timer.current = setTimeout(settle, SETTLE_MS)
      }}
      className={cn(
        "relative flex snap-x snap-mandatory items-end gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none]",
        "px-[calc(var(--gutter)+0.5rem)]"
      )}
    >
      {copies.flatMap((copy) =>
        places.map((place) => {
          const here = place.id === selected
          return (
            <li
              key={`${copy}-${place.id}`}
              aria-hidden={copy !== 1 && loop ? true : undefined}
              aria-current={here ? "true" : undefined}
              onClick={() => (here ? onToggle() : onSelect(place.id))}
              // Pulled up, the card grows to fit what it holds, up to most of the screen.
              style={
                here && open
                  ? { minHeight: CARD_PX, maxHeight: "70dvh" }
                  : { height: CARD_PX }
              }
              className={cn(
                "flex w-[calc(100%-2*var(--gutter)-1rem)] shrink-0 cursor-pointer snap-center flex-col overflow-hidden rounded-control border border-border bg-background/80 p-4 shadow-window backdrop-blur-md",
                // Only a pulled-up card scrolls on its own; a closed one leaves every swipe to the row.
                here && open && "overflow-y-auto",
                "[interpolate-size:allow-keywords] motion-safe:transition-[height] motion-safe:duration-300"
              )}
            >
              {render(place, here && open)}
            </li>
          )
        })
      )}
    </ol>
  )
}

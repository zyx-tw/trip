"use client"

import { Photo } from "@/components/photo"
import type { Place } from "@/lib/types"
import { cn } from "@/lib/utils"

type Link = { label: string; url: string }

/** What an opened place shows: its photos, note, address and links. */
export function PlaceDetail({
  place,
  links,
}: {
  place: Place
  links: Link[]
}) {
  return (
    <>
      {place.photos.length > 0 && (
        // Each picture fills the width; swipe or scroll sideways for the next.
        <span className="mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto">
          {place.photos.map((src) => (
            <Photo
              key={src}
              url={src}
              className={cn(
                "aspect-[3/2] shrink-0 snap-start",
                // With more than one, the next one peeks in from the right.
                place.photos.length > 1 ? "w-[88%]" : "w-full"
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
        <span lang="ja" className="mt-2 text-caption text-muted-foreground">
          {place.address}
        </span>
      )}
      {links.length > 0 && <PlaceLinks links={links} />}
    </>
  )
}

export function PlaceLinks({ links }: { links: Link[] }) {
  return (
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
  )
}

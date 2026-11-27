"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

/** The address of a place's photo through the resizing route. */
export const photoSrc = (url: string, width: 24 | 800) =>
  `/api/photo?u=${encodeURIComponent(url)}&w=${width}`

/** Asks the browser for every picture ahead of time: the stand-ins first, then the pictures. */
export function preloadPhotos(urls: string[]) {
  for (const width of [24, 800] as const)
    for (const url of urls) new Image().src = photoSrc(url, width)
}

/**
 * A photo that shows a blurred 24px copy at once and fades the sharp
 * 800px one in over it when it arrives.
 */
export function Photo({ url, className }: { url: string; className?: string }) {
  const [ready, setReady] = useState(false)
  return (
    <span className={cn("relative block overflow-hidden bg-muted", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served already resized by /api/photo */}
      <img
        src={photoSrc(url, 24)}
        alt=""
        aria-hidden
        className="absolute inset-0 size-full scale-110 object-cover blur-md"
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- served already resized by /api/photo */}
      <img
        src={photoSrc(url, 800)}
        alt=""
        onLoad={() => setReady(true)}
        className={cn(
          "absolute inset-0 size-full object-cover motion-safe:transition-opacity motion-safe:duration-500",
          ready ? "opacity-100" : "opacity-0"
        )}
      />
    </span>
  )
}

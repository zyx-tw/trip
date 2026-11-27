"use client"

import "maplibre-gl/dist/maplibre-gl.css"

import * as maplibregl from "maplibre-gl"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"

import type { Place } from "@/lib/types"

export type Pin = Place & { emoji: string }
export type Line = { id: string; color: string; points: [number, number][] }

const LINES = "trip-lines"

/** Puts the walks on the map, again after each style change wipes them. */
function drawLines(m: maplibregl.Map, lines: Line[]) {
  const data: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: lines.map((l) => ({
      type: "Feature",
      properties: { color: l.color },
      geometry: { type: "LineString", coordinates: l.points },
    })),
  }
  const source = m.getSource(LINES) as maplibregl.GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }
  m.addSource(LINES, { type: "geojson", data })
  m.addLayer({
    id: LINES,
    type: "line",
    source: LINES,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 3,
      "line-dasharray": [1, 1.5],
    },
  })
}

const STYLE = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
}

/** The trip's places as numbered pins. Tapping a pin selects its place. */
export function TripMap({
  pins,
  lines,
  selected,
  onSelect,
  padding,
}: {
  pins: Pin[]
  lines: Line[]
  /** Pixels of the map hidden under the panel on each side. */
  padding: maplibregl.PaddingOptions
  selected: string | null
  onSelect: (id: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markers = useRef(new Map<string, maplibregl.Marker>())
  const fitted = useRef(false)
  // Without WebGL2 there is no map; the list below still has every place and its links.
  const [broken] = useState(
    () => !document.createElement("canvas").getContext("webgl2")
  )
  const { resolvedTheme } = useTheme()
  const style = resolvedTheme === "light" ? STYLE.light : STYLE.dark
  const select = useRef(onSelect)
  useEffect(() => {
    select.current = onSelect
  }, [onSelect])

  useEffect(() => {
    if (!box.current || broken) return
    maplibregl.setWorkerUrl(
      new URL("/maplibre/maplibre-gl-worker.mjs", location.origin).href
    )
    const m = new maplibregl.Map({
      container: box.current,
      style,
      center: [139.77, 35.68],
      zoom: 10,
      attributionControl: {
        compact: true,
        customAttribution: [
          '<a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">Transitous</a>',
          '<a href="https://routing.openstreetmap.de/" target="_blank" rel="noreferrer">FOSSGIS OSRM</a>',
        ],
      },
    })
    m.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    )
    m.addControl(
      new maplibregl.GeolocateControl({ trackUserLocation: true }),
      "top-right"
    )
    map.current = m
    // The compact attribution opens on load; start it folded so it does not cover the map.
    m.once("load", () =>
      m
        .getContainer()
        .querySelector(".maplibregl-compact-show")
        ?.classList.remove("maplibregl-compact-show")
    )
    const placed = markers.current
    return () => {
      m.remove()
      map.current = null
      placed.clear()
      fitted.current = false
    }
    // The style follows the theme below; the map itself is made once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const paddingRef = useRef(padding)
  useEffect(() => {
    paddingRef.current = padding
  }, [padding])

  const linesRef = useRef(lines)
  useEffect(() => {
    linesRef.current = lines
    const m = map.current
    if (m?.isStyleLoaded()) drawLines(m, lines)
  }, [lines])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const redraw = () => drawLines(m, linesRef.current)
    m.on("style.load", redraw)
    m.setStyle(style)
    return () => {
      m.off("style.load", redraw)
    }
  }, [style])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const pin of pins) {
      seen.add(pin.id)
      let marker = markers.current.get(pin.id)
      if (!marker) {
        const el = document.createElement("button")
        el.type = "button"
        el.className =
          "trip-pin text-title leading-none motion-safe:transition-transform"
        el.addEventListener("click", (event) => {
          event.stopPropagation()
          select.current(pin.id)
        })
        marker = new maplibregl.Marker({ element: el })
          .setLngLat([pin.lng, pin.lat])
          .addTo(m)
        markers.current.set(pin.id, marker)
      }
      const el = marker.getElement()
      el.textContent = pin.emoji
      el.setAttribute("aria-label", pin.nameZh || pin.name)
      marker.setLngLat([pin.lng, pin.lat])
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove()
        markers.current.delete(id)
      }
    }
    if (!fitted.current && pins.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const p of pins) bounds.extend([p.lng, p.lat])
      m.fitBounds(bounds, {
        padding: paddingRef.current,
        maxZoom: 15,
        duration: 0,
      })
      fitted.current = true
    }
  }, [pins])

  useEffect(() => {
    for (const [id, marker] of markers.current) {
      marker.getElement().style.scale = id === selected ? "1.4" : ""
      marker.getElement().style.zIndex = id === selected ? "1" : ""
    }
    const pin = pins.find((p) => p.id === selected)
    if (pin)
      map.current?.flyTo({
        center: [pin.lng, pin.lat],
        zoom: Math.max(map.current.getZoom(), 15),
      })
    // Fly only when the selection changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  return (
    <div
      ref={box}
      role="region"
      aria-label="地圖"
      className="relative h-full w-full"
    >
      {broken && (
        <p className="flex h-full items-center justify-center bg-muted text-muted-foreground">
          無法顯示地圖
        </p>
      )}
    </div>
  )
}

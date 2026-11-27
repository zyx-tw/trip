// MapLibre finds its worker next to its own chunk, which the Next bundle does
// not keep. Copy the worker to public/ so the map can name it with setWorkerUrl.
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const dist = dirname(require.resolve("maplibre-gl/package.json"))
mkdirSync("public/maplibre", { recursive: true })
copyFileSync(join(dist, "dist/maplibre-gl-worker.mjs"), "public/maplibre/maplibre-gl-worker.mjs")

# trip

Trip maps at trip.zyx.tw: each trip has days, each day has places in order, and every place opens in the map apps people use in that country. An agent adds, edits and removes places over MCP, and open pages update at once.

## Features

- A map of the trip's places, a pin color per day, and the list of days below it
- The official name in the country's language and a Traditional Chinese name
- Google Maps and Apple Maps links for each place, and transit routes to it
- Between the places of a day: the walk (time, distance, the path on the map) or, past 1.5 km, the train or bus to take
- MCP at `/mcp` with a bearer token: `list_trips`, `get_trip`, `save_trip`, `delete_trip`, `add_places`, `update_place`, `delete_places`, `plan_route`
- Sign-in through auth.zyx.tw

## Countries

Everything that changes from one country to the next sits in `lib/countries/<code>.ts`: the map apps and their links. Add a country with one file and one line in `lib/countries/index.ts`.

## Development

```sh
bun install
TRIP_OPEN_DEV=1 TRIP_TOKEN=$(openssl rand -hex 32) bun run dev
```

`TRIP_OPEN_DEV=1` treats every request as signed in and is refused in production.

## Deploy

ci builds the image in the pull request; a merge to main ships it to VM 117 through land (`.github/workflows/release.yml`). The stack lives in `/opt/trip` with `compose.yaml` and `.env` (see `.env.example`).

## Data

- Map tiles: OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors.
- Walks: the FOSSGIS OSRM foot server (routing.openstreetmap.de), at most 1 request a second, cached for 30 days.
- Timetables: Transitous (transitous.org, sources at transitous.org/sources), at most 1 request a second, cached for a day. Times are timetable data, not live.

Both are community services: lib/server/routing.ts names this app in its User-Agent and queues requests to each host.

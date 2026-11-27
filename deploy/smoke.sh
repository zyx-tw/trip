#!/usr/bin/env bash
# The image as deployed: compose.yaml with a throwaway token, then the health
# check, the sign-in screen and one MCP round trip. ci runs it with the image
# loaded as ghcr.io/zyx1121/trip:ci.
set -euo pipefail
trap 'docker compose logs; docker compose down -v' EXIT
token=$(openssl rand -hex 32)
sed -e 's/^TRIP_VERSION=.*/TRIP_VERSION=ci/' -e "s/^TRIP_TOKEN=.*/TRIP_TOKEN=$token/" -e 's/^TRIP_PORT=.*/TRIP_PORT=3999/' .env.example > .env
docker compose up -d --wait web
base=http://127.0.0.1:3999
curl -fsS "$base/api/health" >/dev/null
page=$(curl -fsS "$base/")
grep -q '登入' <<<"$page"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/mcp" -d '{}')" = 401
mcp() { curl -fsS -X POST "$base/mcp" -H "authorization: Bearer $token" -H 'content-type: application/json' -d "$1"; }
out=$(mcp '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"save_trip","arguments":{"id":"ci","title":"CI","country":"jp","start_date":"2027-01-04","end_date":"2027-01-05"}}}')
grep -q '"startDate' <<<"$out"
out=$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_trips","arguments":{}}}')
grep -q 'CI' <<<"$out"
echo smoke ok

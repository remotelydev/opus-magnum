#!/usr/bin/env bash
# Start or update the Horarium preview (demo data only) from the current checkout and print its public address.
#   apps/horarium/preview/up.sh          build and (re)start, keep the tunnel address if it is already running
#   apps/horarium/preview/up.sh --new-url  also restart the tunnel, which gives a new address
#   docker compose -f apps/horarium/preview/docker-compose.yml down   stop everything
# Needs Docker. The password for the demo logins goes into apps/horarium/preview/.env (never committed):
#   CLINIC_PASSWORD=your-own-password
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]] || ! grep -q '^CLINIC_PASSWORD=..........' .env; then
  echo "Put CLINIC_PASSWORD=<at least 10 characters> into $(pwd)/.env first." >&2
  exit 1
fi

docker compose up -d --build
[[ "${1:-}" == "--new-url" ]] && docker compose restart tunnel

echo "Waiting for Horarium…"
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:8791/health >/dev/null && break
  sleep 2
done
curl -sf http://127.0.0.1:8791/health >/dev/null || { docker compose logs app | tail -30; exit 1; }

for _ in $(seq 1 30); do
  url=$(docker compose logs tunnel 2>/dev/null | grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' | tail -1 || true)
  [[ -n "$url" ]] && break
  sleep 2
done
echo "Locally:  http://127.0.0.1:8791"
echo "Public:   ${url:-not ready yet, run: docker compose -f $(pwd)/docker-compose.yml logs tunnel}"
echo "Logins:   recepcja / admin, password from .env"

#!/usr/bin/env bash
# Share the current checkout of Horarium (demo data only) at a public https://….trycloudflare.com address.
#   CLINIC_PASSWORD='your-own-password' apps/horarium/preview/tunnel.sh
# Needs Docker and cloudflared (brew install cloudflared). Ctrl+C stops the tunnel; the app keeps running
# until: docker compose -f apps/horarium/preview/docker-compose.yml down -v
set -euo pipefail
cd "$(dirname "$0")"

if [[ -z "${CLINIC_PASSWORD:-}" ]]; then
  echo "Set CLINIC_PASSWORD first, so the demo logins do not use the public default password." >&2
  exit 1
fi
command -v cloudflared >/dev/null || { echo "cloudflared is not installed: brew install cloudflared" >&2; exit 1; }

docker compose up -d --build
echo "Waiting for Horarium…"
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:8791/health >/dev/null && break
  sleep 2
done
curl -sf http://127.0.0.1:8791/health >/dev/null || { docker compose logs app | tail -30; exit 1; }

echo "Horarium is up. The public address appears below (…trycloudflare.com)."
exec cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8791

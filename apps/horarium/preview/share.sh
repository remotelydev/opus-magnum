#!/bin/bash
# Share the local Horarium preview publicly (demo data only) while you show it to someone.
#   apps/horarium/preview/share.sh        start the tunnel and print the https://….trycloudflare.com address
#   apps/horarium/preview/share.sh stop   stop it
# Off by default and stays off after a restart.
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH"
NAME="horarium-tunnel"

if [[ "${1:-}" == "stop" ]]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  echo "Tunnel stopped."
  exit 0
fi

curl -sf http://127.0.0.1:8791/health >/dev/null || { echo "The local preview is not running (see install.sh)." >&2; exit 1; }
if ! docker ps -q --filter "name=^$NAME$" | grep -q .; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --network horarium-preview_default \
    cloudflare/cloudflared:2025.10.0 tunnel --no-autoupdate --url http://app:8790 >/dev/null
fi
for _ in $(seq 1 30); do
  url=$(docker logs "$NAME" 2>&1 | grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' | tail -1 || true)
  [[ -n "$url" ]] && { echo "Public address: $url"; echo "Stop with: apps/horarium/preview/share.sh stop"; exit 0; }
  sleep 2
done
echo "The tunnel did not report an address yet:" >&2; docker logs "$NAME" 2>&1 | tail -5 >&2; exit 1

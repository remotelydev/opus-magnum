#!/usr/bin/env bash
# Cloudflare Tunnel in front of local reception-api (127.0.0.1:8788).
# Named tunnel when TUNNEL_TOKEN is set; otherwise a quick trycloudflare URL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${TUNNEL_TOKEN:-}" && -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  export TUNNEL_TOKEN="$CLOUDFLARE_TUNNEL_TOKEN"
fi

TARGET="${TUNNEL_ORIGIN:-http://127.0.0.1:8788}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed." >&2
  echo "On the Mac mini, install it with:" >&2
  echo "  brew install cloudflared" >&2
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  if ! curl -sf --max-time 2 "${TARGET}/health" >/dev/null; then
    echo "reception-api is not answering ${TARGET}/health yet." >&2
    echo "In another terminal, start the API:" >&2
    echo "  pnpm --filter reception-api dev" >&2
    echo "Starting the tunnel anyway (retry /health once the API is up)." >&2
  fi
fi

if [[ -n "${TUNNEL_TOKEN:-}" ]]; then
  echo "Starting named Cloudflare Tunnel (TUNNEL_TOKEN is set)."
  echo "Public hostname is the Published application route in Zero Trust → Tunnels."
  exec cloudflared tunnel --no-autoupdate run
fi

echo "Starting Cloudflare quick tunnel to ${TARGET} (no account token)."
echo "Copy the https://*.trycloudflare.com URL from the log, then from your phone:"
echo "  curl https://<that-host>/health"
exec cloudflared tunnel --no-autoupdate --url "$TARGET"

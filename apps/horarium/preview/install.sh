#!/bin/bash
# One-time setup on the Mac: the local Horarium preview follows the newest open pull request by itself.
#   apps/horarium/preview/install.sh             install (or update) and start
#   apps/horarium/preview/install.sh --uninstall stop and remove the watcher and the preview containers
# Needs Docker Desktop. Afterwards: http://127.0.0.1:8791 (logins recepcja / admin, password in .preview/.env).
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
STATE="$REPO_DIR/.preview"
LABEL="dev.opus-magnum.horarium-preview"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$PLIST"
  docker rm -f horarium-tunnel >/dev/null 2>&1 || true
  HORARIUM_SRC="$STATE/src" docker compose -p horarium-preview -f "$STATE/docker-compose.yml" --env-file "$STATE/.env" down 2>/dev/null || true
  echo "Watcher removed and preview stopped. Data and password stay in $STATE (delete the folder to drop them)."
  exit 0
fi

docker info >/dev/null 2>&1 || { echo "Start Docker Desktop first." >&2; exit 1; }
mkdir -p "$STATE"
[[ -d "$STATE/src/.git" ]] || git clone -q https://github.com/remotelydev/opus-magnum.git "$STATE/src"

if [[ ! -f "$STATE/.env" ]]; then
  if grep -q '^CLINIC_PASSWORD=..........' "$REPO_DIR/apps/horarium/preview/.env" 2>/dev/null; then
    cp "$REPO_DIR/apps/horarium/preview/.env" "$STATE/.env"
  else
    echo "CLINIC_PASSWORD=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)" > "$STATE/.env"
  fi
  chmod 600 "$STATE/.env"
fi

# Containers from the earlier manual up.sh setup (compose project "preview"), if any.
old=$(docker ps -aq --filter label=com.docker.compose.project=preview)
[[ -n "$old" ]] && docker rm -f $old >/dev/null

cp "$REPO_DIR/apps/horarium/preview/watch.sh" "$REPO_DIR/apps/horarium/preview/docker-compose.yml" "$STATE/"
rm -f "$STATE/built-sha" # force a fresh build now

mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$STATE/watch.sh</string><string>$REPO_DIR</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$STATE/watch.log</string>
  <key>StandardErrorPath</key><string>$STATE/watch.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed. The first build takes a few minutes; a notification appears when it is ready."
echo "Address:  http://127.0.0.1:8791"
echo "Logins:   recepcja / admin, $(cat "$STATE/.env")"

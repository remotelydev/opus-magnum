#!/bin/bash
# Keeps the local Horarium preview on the newest open pull request (or main when none is open).
# Run every 2 minutes by launchd (see install.sh):  watch.sh <repo dir>
# State lives in <repo dir>/.preview: src/ (own clone, never your working copy), .env, status.json, watch.log.
set -u
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="${1:?usage: watch.sh <repo dir>}"
STATE="$REPO_DIR/.preview"
SRC="$STATE/src"
GH_REPO="remotelydev/opus-magnum"
PROJECT="horarium-preview"
URL="http://127.0.0.1:8791"

log() { echo "$(date '+%F %T') $*"; }
notify() { osascript -e "display notification \"$1\" with title \"Horarium podgląd\"" >/dev/null 2>&1 || true; }
status() { # state number ref sha title
  printf '{"state":"%s","pr":"%s","ref":"%s","sha":"%s","title":"%s","url":"%s","at":"%s"}\n' \
    "$1" "$2" "$3" "$4" "$(printf '%s' "$5" | tr -d '"\\')" "$URL" "$(date -u +%FT%TZ)" > "$STATE/status.json"
}

docker info >/dev/null 2>&1 || exit 0 # Docker Desktop not running yet

json=$(curl -fsS -m 20 -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$GH_REPO/pulls?state=open&sort=updated&direction=desc&per_page=1") || { log "GitHub API unreachable"; exit 0; }
line=$(osascript -l JavaScript -e 'function run(a){var p=JSON.parse(a[0]);if(!p.length)return "";p=p[0];return [p.number,p.head.sha,p.head.ref,p.title.replace(/[\t\n]/g," ")].join("\t")}' "$json") || { log "could not parse GitHub answer"; exit 0; }

if [[ -n "$line" ]]; then
  IFS=$'\t' read -r number sha ref title <<< "$line"
else
  number=""; ref="main"; title="main (brak otwartych PR-ów)"
  sha=$(git ls-remote "https://github.com/$GH_REPO.git" refs/heads/main | cut -f1)
  [[ -n "$sha" ]] || { log "could not read main"; exit 0; }
fi

[[ "$sha" == "$(cat "$STATE/built-sha" 2>/dev/null)" ]] && exit 0

label="${number:+PR #$number}"; label="${label:-main}"
log "building $label ($ref @ ${sha:0:7})"
status building "$number" "$ref" "$sha" "$title"
echo "$sha" > "$STATE/built-sha" # a failed build is not retried until the next push

if ! git -C "$SRC" fetch -q "https://github.com/$GH_REPO.git" "+refs/heads/$ref:refs/preview/head" \
  || ! git -C "$SRC" checkout -q --force --detach "$sha"; then
  log "git fetch/checkout failed"; status failed "$number" "$ref" "$sha" "$title"; notify "Nie udało się pobrać $label"; exit 0
fi

if ! HORARIUM_SRC="$SRC" docker compose -p "$PROJECT" -f "$STATE/docker-compose.yml" --env-file "$STATE/.env" \
  up -d --build --remove-orphans; then
  log "build failed"; status failed "$number" "$ref" "$sha" "$title"; notify "Build $label się nie udał, szczegóły w .preview/watch.log"; exit 0
fi

for _ in $(seq 1 60); do curl -sf "$URL/health" >/dev/null && break; sleep 2; done
if curl -sf "$URL/health" >/dev/null; then
  log "ready: $label"; status ok "$number" "$ref" "$sha" "$title"; notify "$label gotowy: $URL"
else
  log "app did not become healthy"; status failed "$number" "$ref" "$sha" "$title"; notify "$label nie wstał, szczegóły w .preview/watch.log"
fi

#!/bin/sh
# Preview start: migrate, fill an empty database with made-up demo data, then serve.
# The demo seed refuses to touch a database that already has patients, so this never adds demo rows to real data.
set -e
TSX=./node_modules/.bin/tsx
$TSX scripts/migrate.ts
$TSX scripts/seed-demo.ts || echo "demo seed skipped (database already has data)"
exec $TSX src/index.ts

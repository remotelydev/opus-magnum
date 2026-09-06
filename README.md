# opus-magnum

Personal React / Next.js lab. Public on GitLab for now; self-host later when I have time to maintain it.

## Rules
- **YAGNI** — create folders and packages only when a real task needs them
- **Small steps** — ADHD-friendly tasks; one NOW item at a time
- **Stack** — React, Next.js, TypeScript everywhere; backend in TypeScript only if needed
- **Portfolio home** — GitLab (`devbartosz`); showcase apps live here, linked from [trzos.dev](https://trzos.dev)
- Private notes (job memories, etc.) stay **out of this public repo**

## Layout
- `apps/stock-chart` — first showcase case (ticker chart)
- `packages/` — only when a second app needs shared code

## Setup
```bash
pnpm install
cp .env.example .env.local   # optional: set FINNHUB_API_KEY
pnpm dev                     # http://localhost:3000 → /AAPL
```

Optional live data: free key from [finnhub.io/register](https://finnhub.io/register). Without it, the app uses committed fixtures (`AAPL`, `MSFT`, `NVDA`). Refresh fixtures from Finnhub (replaces the seed placeholders) with:

```bash
pnpm --filter stock-chart generate-fixtures
```

## NOW
Done: monorepo scaffold + stock chart with Finnhub + fixture fallback.

Next: GitLab CI (lint/build), thin smoke test, deploy story for linking from trzos.dev.

## Later (not started)
- Shared `packages/` when a second app needs reuse
- `imports/` when migrating old laptop projects
- More resume-backed cases, newest roles first
- Move hosting to a home server when maintenance capacity exists

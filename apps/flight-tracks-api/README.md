# Flight Tracks API

Serves synthetic flight tracks as **TRK1** binary SoA payloads for a map client (Phase‑0 bootstrap, parallel chunk fetches, AbortController, network failure modes).

## Run

```bash
pnpm install
pnpm --filter flight-tracks-api dev
```

- Health: http://127.0.0.1:8787/health  
- Meta (echoes config): http://127.0.0.1:8787/meta  

## Config

Edit [`config/default.json`](config/default.json) — or point `CONFIG_PATH` at another JSON file.

| Section | Purpose |
|---------|---------|
| `server` | host / port |
| `generator` | seed, flight count, −1h / +8h window |
| `chaos` | delay, jitter, error rate, slow body, truncate, corrupt |

See [PROTOCOL.md](PROTOCOL.md) for the binary layout.

# reception-api

Dental clinic AI receptionist backend (step 2: health + clinic config).

```bash
pnpm install
pnpm --filter reception-api dev
```

- Health: http://127.0.0.1:8788/health
- Config: http://127.0.0.1:8788/config

Hours, ring count, timezone, and clinic placeholders live in `config/default.json`. Edit, restart, then `curl` config again.

Override bind with `HOST` and `PORT`, or `CONFIG_PATH` for another JSON file.

# reception-api

Dental clinic AI receptionist backend (step 2: health + two-location config).

```bash
pnpm install
pnpm --filter reception-api dev
```

- Health: http://127.0.0.1:8788/health
- Both clinics: http://127.0.0.1:8788/config
- Turek: http://127.0.0.1:8788/config/turek
- Poddębice: http://127.0.0.1:8788/config/poddebice

Hours, phones, addresses: `config/default.json`. Edit, restart, curl again.

Override bind with `HOST` and `PORT`, or `CONFIG_PATH` for another JSON file.

# reception-api

Dental clinic AI receptionist backend (step 2: two locations + Prismic pricelist).

```bash
pnpm install
pnpm --filter reception-api dev
```

- Health: http://127.0.0.1:8788/health
- Both clinics + pricelist: http://127.0.0.1:8788/config
- Turek: http://127.0.0.1:8788/config/turek
- Poddębice: http://127.0.0.1:8788/config/poddebice
- Pricelist only: http://127.0.0.1:8788/pricelist

One shared cennik in Prismic for both sites (not split by city). Hours/phones stay in `config/default.json` (contact page is more accurate than Prismic `godziny`).

Override bind with `HOST` and `PORT`, or `CONFIG_PATH` for another JSON file.

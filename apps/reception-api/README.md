# reception-api

Dental clinic AI receptionist backend (step 3: script as tests).

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

Script (no phone yet):

```bash
pnpm --filter reception-api test
```

Fixtures live in `src/script.test.ts`. Add a case there if you want a new sentence or intent.

Override bind with `HOST` and `PORT`, or `CONFIG_PATH` for another JSON file.

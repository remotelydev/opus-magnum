# reception-api

Dental clinic AI receptionist backend (step 4: encrypted transcript store).

```bash
pnpm install
export TRANSCRIPT_KEY=$(openssl rand -hex 32)
pnpm --filter reception-api dev
```

Keep the key on the machine only (`.env` is gitignored). Copy `apps/reception-api/.env.example`.

- Health: http://127.0.0.1:8788/health
- Both clinics + pricelist: http://127.0.0.1:8788/config
- Turek: http://127.0.0.1:8788/config/turek
- Poddębice: http://127.0.0.1:8788/config/poddebice
- Pricelist only: http://127.0.0.1:8788/pricelist

One shared cennik in Prismic for both sites (not split by city). Hours/phones stay in `config/default.json` (contact page is more accurate than Prismic `godziny`).

## Transcripts

Encrypted JSON only (AES-256-GCM). No audio files. Layout under this app:

`transcripts/YYYY-MM-DD/<call-id>.json.enc`

Folders older than 32 days are eligible for purge. Opt-out (`consent: "no"` or `transcribe: false`) skips the write.

```bash
# fake call → encrypted file
curl -s -X POST http://127.0.0.1:8788/dev/transcripts \
  -H 'content-type: application/json' \
  -d '{"callId":"fake-1","consent":"yes"}'

# opt-out → no file
curl -s -X POST http://127.0.0.1:8788/dev/transcripts \
  -H 'content-type: application/json' \
  -d '{"callId":"nope","consent":"no"}'

# dry-run lists a fake 33-day folder (seeded)
curl -s -X POST http://127.0.0.1:8788/dev/purge-old \
  -H 'content-type: application/json' \
  -d '{"dryRun":true,"seed":true}'
```

Override bind with `HOST` and `PORT`, or `CONFIG_PATH` for another JSON file. `TRANSCRIPTS_DIR` moves the folder (default: `apps/reception-api/transcripts`, gitignored).

## Tests

```bash
pnpm --filter reception-api test
```

Script fixtures: `src/script.test.ts`. Transcript store / purge / opt-out: `src/transcripts.test.ts`.

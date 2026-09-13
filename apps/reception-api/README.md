# reception-api

Dental clinic AI receptionist backend (step 5: public URL).

```bash
pnpm install
```

```bash
export TRANSCRIPT_KEY=$(openssl rand -hex 32)
```

Keep the key on the machine only (`.env` is gitignored). Copy `apps/reception-api/.env.example`.

```bash
pnpm --filter reception-api dev
```

- Health: http://127.0.0.1:8788/health
- Both clinics + pricelist: http://127.0.0.1:8788/config
- Turek: http://127.0.0.1:8788/config/turek
- Poddębice: http://127.0.0.1:8788/config/poddebice
- Pricelist only: http://127.0.0.1:8788/pricelist

One shared cennik in Prismic for both sites (not split by city). Hours/phones stay in `config/default.json` (contact page is more accurate than Prismic `godziny`).

Override bind with `HOST` and `PORT`, or `CONFIG_PATH` for another JSON file. `TRANSCRIPTS_DIR` moves the folder (default: `apps/reception-api/transcripts`, gitignored).

## Public URL

The API stays on `127.0.0.1:8788`. Cloudflare Tunnel puts HTTPS in front so Meta/Telnyx can POST later. This step is only the tunnel — no WhatsApp or Telnyx webhooks yet.

Install `cloudflared` once on the Mac mini:

```bash
brew install cloudflared
```

Keep the API running in one terminal (`pnpm --filter reception-api dev` above). In a second terminal, start a **quick tunnel** (no Cloudflare account; URL changes every restart):

```bash
pnpm --filter reception-api tunnel
```

Copy the `https://….trycloudflare.com` host from the `cloudflared` log. From a phone or any machine off localhost:

```bash
curl https://YOUR-TUNNEL-HOST/health
```

Expect `{"ok":true,"service":"reception-api"}`.

### Named tunnel (stable hostname)

Use this when you want the same URL across restarts (needed before webhook vendors). Requires a Cloudflare account and a domain added to Cloudflare.

1. Open [Zero Trust Tunnels](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create a tunnel**.
2. Connector: **Cloudflared**. Name: `reception-api`.
3. Copy the tunnel token (dashboard shows `cloudflared tunnel run --token …`). Put **only the token** in `apps/reception-api/.env` as `TUNNEL_TOKEN=` — never commit `.env`.
4. **Published application** route: subdomain + your Cloudflare domain (e.g. `reception.example.com`). Service URL: `http://127.0.0.1:8788`.

Copy the env example if you do not have `.env` yet:

```bash
cp apps/reception-api/.env.example apps/reception-api/.env
```

Then paste the token into `TUNNEL_TOKEN=` in that file. The same tunnel command picks up the token and runs the named tunnel:

```bash
pnpm --filter reception-api tunnel
```

Check (use your published hostname):

```bash
curl https://reception.example.com/health
```

`cloudflared` itself reads `TUNNEL_TOKEN`. `CLOUDFLARE_TUNNEL_TOKEN` is an optional alias if `TUNNEL_TOKEN` is empty. Quick tunnels ignore both. Override the quick-tunnel origin with `TUNNEL_ORIGIN` if you changed `PORT`.

Do not run `brew services start cloudflared` — that fights this script.

## Transcripts

Encrypted JSON only (AES-256-GCM). No audio files. Layout under this app:

`transcripts/YYYY-MM-DD/<call-id>.json.enc`

Folders older than 32 days are eligible for purge. Opt-out (`consent: "no"` or `transcribe: false`) skips the write.

```bash
curl -s -X POST http://127.0.0.1:8788/dev/transcripts \
  -H 'content-type: application/json' \
  -d '{"callId":"fake-1","consent":"yes"}'
```

```bash
curl -s -X POST http://127.0.0.1:8788/dev/transcripts \
  -H 'content-type: application/json' \
  -d '{"callId":"nope","consent":"no"}'
```

```bash
curl -s -X POST http://127.0.0.1:8788/dev/purge-old \
  -H 'content-type: application/json' \
  -d '{"dryRun":true,"seed":true}'
```

## Tests

```bash
pnpm --filter reception-api test
```

Script fixtures: `src/script.test.ts`. Transcript store / purge / opt-out: `src/transcripts.test.ts`.

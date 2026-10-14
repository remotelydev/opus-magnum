# reception-api

Dental clinic AI receptionist backend (step 6: WhatsApp ticket out).

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

The API stays on `127.0.0.1:8788`. Cloudflare Tunnel puts HTTPS in front so Meta, SMSAPI and ElevenLabs can POST inbound webhooks later. Outbound WhatsApp tickets (this step) do not need a tunnel.

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

## WhatsApp ticket (outbound)

`POST /dev/ticket` sends a Polish booking ticket to **Bartosz’s WhatsApp** via Meta Cloud API. Destination is `WHATSAPP_TO`, not a clinic Business number. Product copy is Polish only.

The ticket is one line with minimal fields only: `PILNE` (when urgent), site, category (`wizyta`, `oddzwonić`, `inne`), new/returning, preferred slot, name, phone, time received. It never carries a transcript, symptoms or a free-text reason; any other body field is ignored. Optional body fields: `locationId`, `time`, `name`, `phone`, `category` (`book`, `callback`, `other`), `slot` (max 40 chars), `urgent`, `returning`.

A public tunnel is **not** required. Env only: token, Phone number ID, destination.

### Meta app / test number

1. Open [Meta for Developers](https://developers.facebook.com/apps/) → **Create app** (Business) or pick an existing app.
2. **Add product** → **WhatsApp**.
3. WhatsApp → **API Setup**. Copy **Phone number ID** (the Meta **test** number, not a clinic line).
4. Copy a token: the dashboard **temporary** token expires in ~24h. For a longer test, Business Manager → **System Users** → generate a token with `whatsapp_business_messaging` (and `whatsapp_business_management` if the UI asks). Never commit it.
5. Under **To**, add Bartosz’s personal WhatsApp to the allowlist (test numbers only send to listed numbers).
6. From that WhatsApp, send any message to the test number. That opens a 24-hour customer-service window, and the ticket (free-form text, not a template) is only delivered inside it. Sending the dashboard `hello_world` template does **not** open the window; only a message from you does.
7. No webhook / callback URL for this step.

Copy the env example if `.env` does not exist yet:

```bash
cp apps/reception-api/.env.example apps/reception-api/.env
```

Edit `apps/reception-api/.env` (gitignored). Set:

- `WHATSAPP_TOKEN=` — access token
- `WHATSAPP_PHONE_NUMBER_ID=` — test Phone number ID (digits)
- `WHATSAPP_TO=` — Bartosz’s number with country code, e.g. `+48500111222`

The API loads `apps/reception-api/.env` on start (does not override vars already in the shell). Restart `dev` after editing `.env`.

Without credentials, the send path still builds the fixture and fails clearly. Terminal 1:

```bash
pnpm --filter reception-api dev
```

Terminal 2 — fixture ticket, no Meta call:

```bash
curl -sS -i -X POST http://127.0.0.1:8788/dev/ticket \
  -H 'content-type: application/json' \
  -d '{}'
```

Expect HTTP 503 and JSON with `"error":"missing_whatsapp_env"`, `"missing":["WHATSAPP_TOKEN","WHATSAPP_PHONE_NUMBER_ID","WHATSAPP_TO"]`, plus `ticket` and `text` matching the fixture, e.g. `Turek · wizyta · nowy · wtorek rano · Jan Kowalski · +48555111222 · 05.10 14:21`.

After filling `.env` and restarting `dev`, the same curl should return `"sent":true` and a `messageId`. The structured message should appear on Bartosz’s WhatsApp. Optional Graph version: `WHATSAPP_GRAPH_VERSION` (default `v22.0`).

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

Script fixtures: `src/script.test.ts`. Transcript store / purge / opt-out: `src/transcripts.test.ts`. WhatsApp ticket fixture / Cloud API send: `src/whatsapp.test.ts`.

# reception-api

Dental clinic AI receptionist backend (step 7: staff OK reply → SMS).

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

Polish public holidays (Easter-based ones included, and 24 December from 2025) count as closed. For a one-off closure, add `"closedDates": ["2026-12-31"]` to that location in `config/default.json`.

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

The API loads `apps/reception-api/.env` on start (does not override vars already in the shell). `dev` restarts by itself when `src/` or `.env` changes.

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

### Ticket template (outside the 24h window)

Plain-text tickets only arrive within 24h of the recipient's last message to the number. An approved template arrives any time. In WhatsApp Manager → **Message templates** → **Create template**, choose category **Utility**, language **Polish**, and name `nowe_zgloszenie`, with this body:

```
Nowe zgłoszenie {{1}}: {{2}}. Odpowiedz na tę wiadomość: OK dzień.miesiąc godzina.
```

`{{1}}` is the ticket number (`#T-0001`) and `{{2}}` is the ticket line. Once Meta approves it, set it in `.env` and restart `dev`:

```
WHATSAPP_TICKET_TEMPLATE=nowe_zgloszenie
```

`/dev/ticket` then answers `"via":"template"`. Staff reply to it with `OK …` exactly as before. Leave the variable empty to go back to plain text.

## Staff OK reply → SMS (webhook)

Each ticket now starts with a number (`#T-0001 · Turek · wizyta · …`, one counter for both sites). Staff confirm a visit by **replying to that ticket** in WhatsApp (hold the message → Reply):

```
OK 7.10 14:30 proszę zabrać zdjęcie RTG
```

reception-api then sends the patient an SMS through SMSAPI.pl and answers on WhatsApp (`#T-0001: SMS wysłany do +48…`):

```
DentaPlus+ Turek: potwierdzamy wizytę 7.10 (śr) o 14:30. Proszę zabrać zdjęcie RTG. W razie zmiany prosimy o telefon +48690649589.
```

Rules: only `WHATSAPP_TO` may confirm; a year is optional (a past date means next year); the note after the time is at most 120 characters; a ticket is confirmed once. Wrong input gets a short Polish hint back. Without `SMSAPI_TOKEN` the SMS is logged and staff are told it was not sent.

Tickets are kept in `apps/reception-api/data/tickets.json` (gitignored, override with `TICKETS_DIR`): number, WhatsApp message id, patient phone and site only, deleted after 32 days.

Setup:

1. Run the **named** tunnel (see above); a quick tunnel URL changes on restart.
2. In `.env`: `WHATSAPP_APP_SECRET` (Meta app → App settings → Basic → App secret) and `WHATSAPP_VERIFY_TOKEN` (any random string, e.g. `openssl rand -hex 16`). Restart `dev`.
3. Meta app → WhatsApp → Configuration → Webhook: Callback URL `https://<your tunnel host>/webhooks/whatsapp`, Verify token = the same string → **Verify and save**. Then subscribe to the `messages` field.
4. Subscribe the app to the WhatsApp Business Account once (without this Meta sends nothing, not even the dashboard **Test**). The WABA ID is on WhatsApp → API Setup, under the test number ("WhatsApp Business Account ID", not the Phone number ID). From the repo root:

   ```bash
   set -a; source apps/reception-api/.env; set +a
   ```

   ```bash
   WABA_ID=<WhatsApp Business Account ID>
   ```

   ```bash
   curl -X POST "https://graph.facebook.com/v22.0/$WABA_ID/subscribed_apps" -H "Authorization: Bearer $WHATSAPP_TOKEN"
   ```

   Expect `{"success":true}`.
5. `POST /dev/ticket`, reply `OK <date> <time>` to the ticket on WhatsApp, and watch the `dev` log for `staff reply handled`.

Check the verify handshake locally:

```bash
curl "http://127.0.0.1:8788/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$WHATSAPP_VERIFY_TOKEN&hub.challenge=123"
```

Expect `123`. A POST without a valid `X-Hub-Signature-256` gets 401.

## Transcripts

Encrypted JSON only (AES-256-GCM). No audio files. Layout under this app:

`transcripts/YYYY-MM-DD/<call-id>.json.enc`

Folders older than 32 days are deleted automatically: once at startup and then every 6 hours. Opt-out (`consent: "no"` or `transcribe: false`) skips the write.

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

Script fixtures: `src/script.test.ts`. Transcript store / purge / opt-out: `src/transcripts.test.ts`. WhatsApp ticket fixture / Cloud API send: `src/whatsapp.test.ts`. Webhook, OK parsing, ticket store and SMSAPI: `src/staff-reply.test.ts`.

## ElevenLabs test agent

A voice agent in ElevenLabs that uses the clinic file and the script rules, so the scripts can be heard and edited with the clinic. It has two tools that call this server through the tunnel: `sprawdz_godziny` (`GET /agent/hours/:site`, open now and next opening, holidays included) and `wyslij_zgloszenie` (`POST /agent/ticket/:site`, sends the WhatsApp ticket). Both check the `x-agent-secret` header against `ELEVENLABS_TOOL_SECRET`.

1. Set `ELEVENLABS_API_KEY` and `ELEVENLABS_TOOL_SECRET` in `.env`.
2. Run `dev` and the tunnel, and copy the tunnel's https URL.
3. Create or update the agent (Turek by default, or add `poddebice`):

```bash
pnpm --filter reception-api agent:sync https://<tunnel host>
```

The script prints the agent's page; use its test call button to talk to it. A booking ends with a ticket on WhatsApp. It keeps the agent and tool ids in `data/elevenlabs-<site>.json`, so running it again updates the same agent. Run it again whenever the prompt changes or the quick tunnel URL changes.

The prompt is built in `src/agent.ts`. Test callers only: real patient calls wait for the EU residency and zero retention answer (plan step 13).

## Free slots (Versum copy)

`GET /agent/availability/:site` reads `versum-export/` (from `versum:export`) and returns the earliest free slots per doctor: open grafik windows minus occupied slots, from 2 h after now, on a 15-minute grid, skipping public holidays and `closedDates`. Optional query: `part` (`rano`, `poludnie`, `popoludnie`), `from` (`YYYY-MM-DD`), `doctor` (Versum employee id). Same `x-agent-secret` header as the other agent tools.

- Visit length: `VISIT_MINUTES` in `.env` (default 30).
- Which doctors: every employee with a calendar whose Versum name ends with the site, unless the site in `config/default.json` has `versumEmployeeIds`.
- `kind=higienizacja` uses the site's `versumHygieneCalendarIds` (the shared "Higieny" calendar). It has no grafik in Versum, so its working time is the clinic's opening hours. Length: `HYGIENE_MINUTES` (default 60).
- `versumNames` maps a Versum id to the name the bot says (e.g. a new surname not yet changed in Versum).
- `stale: true` when the copy is older than 24 h; the agent then gives no times.
- `VERSUM_EXPORT_DIR` moves the folder.

The agent only proposes a time. Staff still book it in Versum and confirm by SMS. Re-run `agent:sync` to add the `sprawdz_wolne_terminy` tool to the agent.

## Bot call transcripts (ElevenLabs post-call webhook)

`POST /webhooks/elevenlabs` takes ElevenLabs' `post_call_transcription` event, checks the `ElevenLabs-Signature` header (`t=…,v0=…`, HMAC-SHA256 of `t.body` with `ELEVENLABS_WEBHOOK_SECRET`, 30 min tolerance), and writes the transcript into the encrypted store above (`transcripts/YYYY-MM-DD/<conversation_id>.json.enc`, 32-day purge). Only caller and agent lines are kept; tool calls are dropped. A caller who says "nie zgadzam się" is not stored. `post_call_audio` and `call_initiation_failure` are answered 200 and ignored.

Setup in ElevenLabs: ElevenAgents → Settings → Post-call webhook, URL `https://<tunnel host>/webhooks/elevenlabs`, transcript on, **audio off**. Copy the secret into `.env` as `ELEVENLABS_WEBHOOK_SECRET`.

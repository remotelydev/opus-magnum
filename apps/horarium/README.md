# Horarium

*Horarium*: the medieval monastic timetable of the hours of the day.

Practice management for the DentaPlus+ clinic (Turek and Poddębice): logins and roles, staff and sites, opening hours, work schedules, services, patients, working hours and appointments, with a change log, plus the reception UI (day view per site, booking, drag to move, visit details, patient search with the full card and editing). Data import and SMS reminders follow.

- `src/`: API (Fastify + PostgreSQL).
- `web/`: reception UI (React + Vite). Built to `web/dist` and served by the same process, so the clinic runs one service.
- Visual components and design tokens come from `packages/dentaplus-ui`.

Runs on the clinic's mini-PC next to `reception-api`. Patient data stays in the local PostgreSQL database and never goes into this repository.

## Run locally

Needs PostgreSQL 16 (with `btree_gist`, included in the standard package). The quickest way is Docker:

```bash
docker compose -f apps/horarium/docker-compose.dev.yml up -d
```

```bash
pnpm install
```

```bash
export DATABASE_URL=postgres://horarium:horarium@127.0.0.1:54329/horarium
```

```bash
pnpm --filter horarium migrate
```

Create the first admin login (password from the environment, at least 10 characters):

```bash
CLINIC_PASSWORD='change-me-please' pnpm --filter horarium user:create admin admin "Administrator"
```

```bash
pnpm --filter horarium build
```

```bash
pnpm --filter horarium dev
```

Open http://127.0.0.1:8790. For UI work with hot reload, run `dev` and `dev:web` side by side and open http://127.0.0.1:5174 (it proxies `/api`).

Demo data (made-up patients, only on an empty database; logins `recepcja` and `admin`, password `demo-demo-demo` unless `CLINIC_PASSWORD` is set):

```bash
pnpm --filter horarium seed:demo
```

- Health: http://127.0.0.1:8790/health
- Log in: `POST /api/auth/login` with `{"login","password"}`. The response has a token (send as `Authorization: Bearer …`) and sets an HttpOnly `session` cookie for the browser UI.

## Preview (demo data only)

The Mac keeps a local preview at http://127.0.0.1:8791 that follows the most recently updated open pull request by itself (or `main` when none is open). A launchd job runs `preview/watch.sh` every 2 minutes: it asks GitHub for the newest open PR, and when its commit changed, checks it out in its own clone (`.preview/src`, never your working copy), rebuilds the Docker image and shows a macOS notification when it is ready. The preview has its own database with made-up demo data (`preview/start.sh` seeds it) and never touches the clinic database: real patient data stays on the clinic server.

One-time setup (Docker Desktop must be running). It generates the password for the demo logins `recepcja` and `admin` and prints it; it is kept in `.preview/.env`:

```bash
apps/horarium/preview/install.sh
```

State and logs: `.preview/status.json` (what is shown and whether it built), `.preview/watch.log`. Remove with `install.sh --uninstall`.

To show the app to others, share it publicly only while needed (a `https://….trycloudflare.com` address; off by default and after a restart):

```bash
apps/horarium/preview/share.sh
```

```bash
apps/horarium/preview/share.sh stop
```

## Tests

Tests need an empty database they can wipe:

```bash
TEST_DATABASE_URL=postgres://horarium:horarium@127.0.0.1:5432/horarium_test pnpm --filter horarium test
```

Without `TEST_DATABASE_URL` the API tests are skipped. CI runs them against a Postgres service.

## API (phase 1)

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout` | anyone |
| GET | `/api/me`, `/api/sites`, `/api/staff`, `/api/services` | any login |
| POST / PATCH | `/api/staff`, `/api/staff/:id` (name, title, phone, e-mail, sites, active, column order) | admin |
| POST | `/api/services` | admin |
| GET | `/api/opening-hours` (week and holidays of each site) | any login |
| PUT | `/api/opening-hours/:site` (the week), PUT / DELETE `/api/opening-hours/:site/exceptions/:date` (holiday or changed day) | admin |
| GET / PUT | `/api/staff/:id/pattern` (weekly work pattern) | read: any login, write: admin, reception |
| POST | `/api/staff/:id/schedule/generate` `{from, to}` (lay the pattern over the dates) | admin, reception |
| GET | `/api/staff/:id/schedules?from=&to=` (one person's working hours and absences) | any login |
| GET | `/api/public/services`, `/api/public/opening-hours`, `/api/public/staff` (`?from=YYYY-MM-DD&days=N`, up to 62) | anyone, read-only |
| GET | `/api/patients?q=` (name prefix or phone; no notes or medical flags), `/api/patients/:id` (full card with visits) | any login |
| GET | `/api/patients/:id/history` (change log of the patient and their visits) | admin |
| POST / PATCH | `/api/patients`, `/api/patients/:id` | admin, reception |
| GET | `/api/schedules?site=&from=&to=` | any login |
| POST / DELETE | `/api/schedules`, `/api/schedules/:id` | admin, reception |
| GET | `/api/appointments?site=&from=&to=[&staffId=]` (max 42 days) | any login |
| POST / PATCH | `/api/appointments`, `/api/appointments/:id` | admin, reception |

Rules built in:
- One staff member cannot have two live appointments at the same time (database constraint, answers 409). Cancelled and no-show visits free the slot.
- A visit without an end time takes the service duration. A move keeps the visit length.
- Booking outside the working hours, at the wrong site or during an absence is allowed but returns `warnings`, as reception sometimes needs it.
- Every write goes to `audit_log`, and so does every opening of a patient card (`patient.view`). Patient edits log only the field names, not medical content. Admins see a patient's log under "Historia zmian" in the visit panel.
- Logins: after 5 failed attempts for one login from one address (or 20 from one address) within 15 minutes, further attempts get 429 until the window passes. Failed attempts are logged as `auth.failed`.
- Request logs keep only the path, never the query string, so patient searches do not end up in log files.
- Phone numbers are stored as E.164 (`+48…`), so the bot can match callers.
- Working hours come from a weekly pattern per person ("Grafik pracy"). Laying it over a date range replaces the work blocks in that range, keeps absences and skips days the site is closed (holidays in "Godziny otwarcia").
- For the reception bot: `/api/public/opening-hours` gives each site's regular week, whether it is open now, and the effective hours day by day with holidays applied; `/api/public/staff` gives active staff (name, title, sites, no contact data) with their working hours day by day, absence days left out. Publish only `/api/public/services` through a tunnel; the bot reads the other two inside the clinic network.

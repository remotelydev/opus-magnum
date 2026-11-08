# clinic

Own calendar for the DentaPlus+ clinic (Turek and Poddębice), replacing Versum: logins and roles, staff and sites, services, patients, working hours and appointments, with a change log, plus the reception UI (day view per site, booking, drag to move, visit details). Versum import and SMS reminders follow.

- `src/`: API (Fastify + PostgreSQL).
- `web/`: reception UI (React + Vite). Built to `web/dist` and served by the same process, so the clinic runs one service.
- Visual components and design tokens come from `packages/dentaplus-ui`.

Runs on the clinic's mini-PC next to `reception-api`. Patient data stays in the local PostgreSQL database and never goes into this repository.

## Run locally

Needs PostgreSQL 16 (with `btree_gist`, included in the standard package).

```bash
pnpm install
```

```bash
export DATABASE_URL=postgres://clinic:clinic@127.0.0.1:5432/clinic
```

```bash
pnpm --filter clinic migrate
```

Create the first admin login (password from the environment, at least 10 characters):

```bash
CLINIC_PASSWORD='change-me-please' pnpm --filter clinic user:create admin admin "Administrator"
```

```bash
pnpm --filter clinic build
```

```bash
pnpm --filter clinic dev
```

Open http://127.0.0.1:8790. For UI work with hot reload, run `dev` and `dev:web` side by side and open http://127.0.0.1:5174 (it proxies `/api`).

Demo data (made-up patients, only on an empty database; logins `recepcja` and `admin`, password `demo-demo-demo` unless `CLINIC_PASSWORD` is set):

```bash
pnpm --filter clinic seed:demo
```

- Health: http://127.0.0.1:8790/health
- Log in: `POST /api/auth/login` with `{"login","password"}`. The response has a token (send as `Authorization: Bearer …`) and sets an HttpOnly `session` cookie for the browser UI.

## Tests

Tests need an empty database they can wipe:

```bash
TEST_DATABASE_URL=postgres://clinic:clinic@127.0.0.1:5432/clinic_test pnpm --filter clinic test
```

Without `TEST_DATABASE_URL` the API tests are skipped. CI runs them against a Postgres service.

## API (phase 1)

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout` | anyone |
| GET | `/api/me`, `/api/sites`, `/api/staff`, `/api/services` | any login |
| POST | `/api/staff`, `/api/services` | admin |
| GET | `/api/patients?q=` (name prefix or phone), `/api/patients/:id` (with visits) | any login |
| POST / PATCH | `/api/patients`, `/api/patients/:id` | admin, reception |
| GET | `/api/schedules?site=&from=&to=` | any login |
| POST / DELETE | `/api/schedules`, `/api/schedules/:id` | admin, reception |
| GET | `/api/appointments?site=&from=&to=[&staffId=]` (max 42 days) | any login |
| POST / PATCH | `/api/appointments`, `/api/appointments/:id` | admin, reception |

Rules built in:
- One staff member cannot have two live appointments at the same time (database constraint, answers 409). Cancelled and no-show visits free the slot.
- A visit without an end time takes the service duration. A move keeps the visit length.
- Booking outside the working hours, at the wrong site or during an absence is allowed but returns `warnings`, as reception sometimes needs it.
- Every write goes to `audit_log`. Patient edits log only the field names, not medical content.
- Phone numbers are stored as E.164 (`+48…`), so the bot can match callers.

// Settings: staff list, opening hours per site, and work schedules generated from a weekly pattern.
// The read-only /api/public/* routes are for the reception bot and the clinic website.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type pg from "pg";
import { audit, type Db } from "./db.js";

export const CLINIC_TZ = "Europe/Warsaw";
const PUBLIC_CACHE_SECONDS = 60;
/** Longest range one "generate schedule" call may fill (Versum keeps schedules ~2 years ahead). */
export const MAX_GENERATE_DAYS = 800;
const MAX_PUBLIC_DAYS = 62;

export const WEEKDAYS = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"] as const;

const hhmm = { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" } as const;
const isoDate = { type: "string", format: "date" } as const;
const idParams = { type: "object", properties: { id: { type: "integer" } } } as const;

interface Guards {
  read: preHandlerAsyncHookHandler;
  write: preHandlerAsyncHookHandler;
  admin: preHandlerAsyncHookHandler;
}

function badRequest(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/** "08:00:00" from Postgres to "08:00". */
export function shortTime(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 5) : null;
}

const STAFF_COLUMNS = {
  name: "name",
  kind: "kind",
  title: "title",
  phone: "phone",
  email: "email",
  active: "active",
  sortOrder: "sort_order",
} as const;
type StaffField = keyof typeof STAFF_COLUMNS;
type StaffBody = Partial<{
  name: string;
  kind: "person" | "calendar";
  title: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  sortOrder: number;
  sites: string[];
}>;

const staffProps = {
  name: { type: "string", minLength: 1, maxLength: 120 },
  kind: { enum: ["person", "calendar"] },
  title: { type: ["string", "null"], maxLength: 80 },
  phone: { type: ["string", "null"], maxLength: 40 },
  email: { type: ["string", "null"], maxLength: 120 },
  active: { type: "boolean" },
  sortOrder: { type: "integer" },
  sites: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true },
} as const;

function cleanStaff(body: StaffBody): StaffBody {
  const out = { ...body };
  for (const key of ["title", "phone", "email"] as const) {
    if (typeof out[key] === "string") out[key] = out[key]!.trim() || null;
  }
  if (typeof out.name === "string") {
    out.name = out.name.trim();
    if (!out.name) throw badRequest("Podaj imię i nazwisko.");
  }
  return out;
}

const STAFF_SELECT = `
  SELECT st.id, st.name, st.kind, st.title, st.phone, st.email, st.active, st.sort_order,
         COALESCE(array_agg(ss.site_id ORDER BY ss.site_id) FILTER (WHERE ss.site_id IS NOT NULL), '{}') AS sites
    FROM staff st LEFT JOIN staff_sites ss ON ss.staff_id = st.id`;

function staffRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    title: r.title ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    active: r.active,
    sortOrder: r.sort_order,
    sites: r.sites,
  };
}

type Week = Array<{ weekday: number; opens: string; closes: string }>;
type PatternDay = { weekday: number; siteId: string; starts: string; ends: string };

function checkRanges<T extends { weekday: number }>(rows: T[], start: (r: T) => string, end: (r: T) => string) {
  for (const r of rows) {
    if (end(r) <= start(r)) throw badRequest(`${WEEKDAYS[r.weekday - 1]}: koniec przed początkiem.`);
  }
}

/** Two ranges of the same person on the same weekday may not overlap. */
export function overlappingDay(days: PatternDay[]): number | null {
  const sorted = [...days].sort((a, b) => a.weekday - b.weekday || a.starts.localeCompare(b.starts));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].weekday === sorted[i - 1].weekday && sorted[i].starts < sorted[i - 1].ends) return sorted[i].weekday;
  }
  return null;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function allowPublic(req: FastifyRequest, reply: FastifyReply, origins: string[]) {
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) {
    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
  }
  reply.header("cache-control", `public, max-age=${PUBLIC_CACHE_SECONDS}`);
}

async function inTransaction<T>(db: Db, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function registerSettings(app: FastifyInstance, db: Db, guards: Guards, publicOrigins: string[]) {
  // --- staff ------------------------------------------------------------------------------
  app.get("/api/staff", { preHandler: guards.read }, async () => {
    const { rows } = await db.query(`${STAFF_SELECT} GROUP BY st.id ORDER BY st.sort_order, st.name`);
    return rows.map(staffRow);
  });

  app.post<{ Body: StaffBody }>(
    "/api/staff",
    {
      preHandler: guards.admin,
      schema: { body: { type: "object", required: ["name", "sites"], properties: staffProps } },
    },
    async (req, reply) => {
      const body = cleanStaff(req.body);
      const id = await inTransaction(db, async (client) => {
        const keys = (Object.keys(body) as StaffField[]).filter((k) => k in STAFF_COLUMNS);
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO staff (${keys.map((k) => STAFF_COLUMNS[k]).join(", ")})
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
          keys.map((k) => body[k]),
        );
        for (const site of body.sites!) {
          await client.query("INSERT INTO staff_sites (staff_id, site_id) VALUES ($1, $2)", [rows[0].id, site]);
        }
        await audit(client, req.user!.id, "staff.create", "staff", rows[0].id, body);
        return rows[0].id;
      });
      return reply.code(201).send({ id });
    },
  );

  app.patch<{ Params: { id: number }; Body: StaffBody }>(
    "/api/staff/:id",
    {
      preHandler: guards.admin,
      schema: { params: idParams, body: { type: "object", properties: staffProps, minProperties: 1 } },
    },
    async (req, reply) => {
      const body = cleanStaff(req.body);
      const keys = (Object.keys(body) as StaffField[]).filter((k) => k in STAFF_COLUMNS);
      const found = await inTransaction(db, async (client) => {
        const exists = await client.query("SELECT 1 FROM staff WHERE id = $1 FOR UPDATE", [req.params.id]);
        if (!exists.rowCount) return false;
        if (keys.length) {
          await client.query(
            `UPDATE staff SET ${keys.map((k, i) => `${STAFF_COLUMNS[k]} = $${i + 2}`).join(", ")} WHERE id = $1`,
            [req.params.id, ...keys.map((k) => body[k])],
          );
        }
        if (body.sites) {
          await client.query("DELETE FROM staff_sites WHERE staff_id = $1", [req.params.id]);
          for (const site of body.sites) {
            await client.query("INSERT INTO staff_sites (staff_id, site_id) VALUES ($1, $2)", [req.params.id, site]);
          }
        }
        await audit(client, req.user!.id, "staff.update", "staff", req.params.id, body);
        return true;
      });
      if (!found) return reply.code(404).send({ error: "Nie ma takiego pracownika." });
      return { ok: true };
    },
  );

  // --- opening hours ----------------------------------------------------------------------
  async function openingHours() {
    const [sites, week, exceptions] = await Promise.all([
      db.query("SELECT id, name FROM sites ORDER BY name"),
      db.query("SELECT * FROM opening_hours ORDER BY site_id, weekday"),
      db.query(
        `SELECT * FROM opening_exceptions
          WHERE day >= (now() AT TIME ZONE '${CLINIC_TZ}')::date - 7 ORDER BY site_id, day`,
      ),
    ]);
    return sites.rows.map((s) => ({
      id: s.id as string,
      name: s.name as string,
      week: week.rows
        .filter((r) => r.site_id === s.id)
        .map((r) => ({ weekday: r.weekday, opens: shortTime(r.opens)!, closes: shortTime(r.closes)! })),
      exceptions: exceptions.rows
        .filter((r) => r.site_id === s.id)
        .map((r) => ({
          date: r.day as string,
          opens: shortTime(r.opens),
          closes: shortTime(r.closes),
          closed: r.opens === null,
          note: r.note ?? null,
        })),
    }));
  }

  app.get("/api/opening-hours", { preHandler: guards.read }, async () => ({ timezone: CLINIC_TZ, sites: await openingHours() }));

  app.put<{ Params: { site: string }; Body: { week: Week } }>(
    "/api/opening-hours/:site",
    {
      preHandler: guards.admin,
      schema: {
        body: {
          type: "object",
          required: ["week"],
          properties: {
            week: {
              type: "array",
              maxItems: 7,
              items: {
                type: "object",
                required: ["weekday", "opens", "closes"],
                properties: { weekday: { type: "integer", minimum: 1, maximum: 7 }, opens: hhmm, closes: hhmm },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { week } = req.body;
      if (new Set(week.map((d) => d.weekday)).size !== week.length) throw badRequest("Każdy dzień tygodnia tylko raz.");
      checkRanges(week, (d) => d.opens, (d) => d.closes);
      const site = await db.query("SELECT 1 FROM sites WHERE id = $1", [req.params.site]);
      if (!site.rowCount) return reply.code(404).send({ error: "Nie ma takiej placówki." });
      await inTransaction(db, async (client) => {
        await client.query("DELETE FROM opening_hours WHERE site_id = $1", [req.params.site]);
        for (const d of week) {
          await client.query("INSERT INTO opening_hours (site_id, weekday, opens, closes) VALUES ($1, $2, $3, $4)", [
            req.params.site,
            d.weekday,
            d.opens,
            d.closes,
          ]);
        }
        await audit(client, req.user!.id, "opening_hours.update", "site", req.params.site, { week });
      });
      return { ok: true };
    },
  );

  app.put<{ Params: { site: string; day: string }; Body: { opens?: string | null; closes?: string | null; note?: string | null } }>(
    "/api/opening-hours/:site/exceptions/:day",
    {
      preHandler: guards.admin,
      schema: {
        params: { type: "object", properties: { site: { type: "string" }, day: isoDate } },
        body: {
          type: "object",
          properties: {
            opens: { anyOf: [hhmm, { type: "null" }] },
            closes: { anyOf: [hhmm, { type: "null" }] },
            note: { type: ["string", "null"], maxLength: 120 },
          },
        },
      },
    },
    async (req) => {
      const opens = req.body.opens ?? null;
      const closes = req.body.closes ?? null;
      if ((opens === null) !== (closes === null)) throw badRequest("Podaj obie godziny albo żadnej (zamknięte).");
      if (opens && closes && closes <= opens) throw badRequest("Koniec przed początkiem.");
      const note = req.body.note?.trim() || null;
      await db.query(
        `INSERT INTO opening_exceptions (site_id, day, opens, closes, note) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (site_id, day) DO UPDATE SET opens = $3, closes = $4, note = $5`,
        [req.params.site, req.params.day, opens, closes, note],
      );
      await audit(db, req.user!.id, "opening_exception.set", "site", req.params.site, { day: req.params.day, opens, closes, note });
      return { ok: true };
    },
  );

  app.delete<{ Params: { site: string; day: string } }>(
    "/api/opening-hours/:site/exceptions/:day",
    {
      preHandler: guards.admin,
      schema: { params: { type: "object", properties: { site: { type: "string" }, day: isoDate } } },
    },
    async (req, reply) => {
      const { rowCount } = await db.query("DELETE FROM opening_exceptions WHERE site_id = $1 AND day = $2", [
        req.params.site,
        req.params.day,
      ]);
      if (!rowCount) return reply.code(404).send({ error: "Nie ma takiego wpisu." });
      await audit(db, req.user!.id, "opening_exception.delete", "site", req.params.site, { day: req.params.day });
      return { ok: true };
    },
  );

  // --- work pattern and schedule -----------------------------------------------------------
  async function pattern(staffId: number): Promise<PatternDay[]> {
    const { rows } = await db.query("SELECT * FROM work_patterns WHERE staff_id = $1 ORDER BY weekday, starts", [staffId]);
    return rows.map((r) => ({ weekday: r.weekday, siteId: r.site_id, starts: shortTime(r.starts)!, ends: shortTime(r.ends)! }));
  }

  app.get<{ Params: { id: number } }>(
    "/api/staff/:id/pattern",
    { preHandler: guards.read, schema: { params: idParams } },
    async (req) => pattern(req.params.id),
  );

  app.put<{ Params: { id: number }; Body: { days: PatternDay[] } }>(
    "/api/staff/:id/pattern",
    {
      preHandler: guards.write,
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["days"],
          properties: {
            days: {
              type: "array",
              maxItems: 28,
              items: {
                type: "object",
                required: ["weekday", "siteId", "starts", "ends"],
                properties: { weekday: { type: "integer", minimum: 1, maximum: 7 }, siteId: { type: "string" }, starts: hhmm, ends: hhmm },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { days } = req.body;
      checkRanges(days, (d) => d.starts, (d) => d.ends);
      const clash = overlappingDay(days);
      if (clash) throw badRequest(`${WEEKDAYS[clash - 1]}: godziny nachodzą na siebie.`);
      const staff = await db.query("SELECT 1 FROM staff WHERE id = $1", [req.params.id]);
      if (!staff.rowCount) return reply.code(404).send({ error: "Nie ma takiego pracownika." });
      await inTransaction(db, async (client) => {
        await client.query("DELETE FROM work_patterns WHERE staff_id = $1", [req.params.id]);
        for (const d of days) {
          await client.query(
            "INSERT INTO work_patterns (staff_id, weekday, site_id, starts, ends) VALUES ($1, $2, $3, $4, $5)",
            [req.params.id, d.weekday, d.siteId, d.starts, d.ends],
          );
        }
        await audit(client, req.user!.id, "work_pattern.update", "staff", req.params.id, { days });
      });
      return { ok: true };
    },
  );

  // Writes the saved weekly pattern into `schedules` for every day from..to (both included).
  // Work hours already in that range are replaced; absences stay. Days the site is closed
  // (holiday in opening exceptions) are skipped.
  app.post<{ Params: { id: number }; Body: { from: string; to: string } }>(
    "/api/staff/:id/schedule/generate",
    {
      preHandler: guards.write,
      schema: {
        params: idParams,
        body: { type: "object", required: ["from", "to"], properties: { from: isoDate, to: isoDate } },
      },
    },
    async (req, reply) => {
      const { from, to } = req.body;
      const span = daysBetween(from, to);
      if (span < 0) throw badRequest("Data „do” jest przed „od”.");
      if (span >= MAX_GENERATE_DAYS) throw badRequest(`Najwyżej ${MAX_GENERATE_DAYS} dni naraz.`);
      const staff = await db.query("SELECT 1 FROM staff WHERE id = $1", [req.params.id]);
      if (!staff.rowCount) return reply.code(404).send({ error: "Nie ma takiego pracownika." });
      const result = await inTransaction(db, async (client) => {
        const removed = await client.query(
          `DELETE FROM schedules
            WHERE staff_id = $1 AND kind = 'work'
              AND starts_at >= ($2::date)::timestamp AT TIME ZONE '${CLINIC_TZ}'
              AND starts_at < ($3::date + 1)::timestamp AT TIME ZONE '${CLINIC_TZ}'`,
          [req.params.id, from, to],
        );
        const created = await client.query(
          `INSERT INTO schedules (staff_id, site_id, starts_at, ends_at, kind)
           SELECT p.staff_id, p.site_id,
                  (d::date + p.starts) AT TIME ZONE '${CLINIC_TZ}',
                  (d::date + p.ends) AT TIME ZONE '${CLINIC_TZ}', 'work'
             FROM generate_series($2::date, $3::date, interval '1 day') d
             JOIN work_patterns p ON p.staff_id = $1 AND p.weekday = extract(isodow FROM d)
            WHERE NOT EXISTS (SELECT 1 FROM opening_exceptions e
                               WHERE e.site_id = p.site_id AND e.day = d::date AND e.opens IS NULL)`,
          [req.params.id, from, to],
        );
        const skipped = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM generate_series($2::date, $3::date, interval '1 day') d
             JOIN work_patterns p ON p.staff_id = $1 AND p.weekday = extract(isodow FROM d)
             JOIN opening_exceptions e ON e.site_id = p.site_id AND e.day = d::date AND e.opens IS NULL`,
          [req.params.id, from, to],
        );
        const counts = { created: created.rowCount ?? 0, removed: removed.rowCount ?? 0, skippedClosed: skipped.rows[0].n };
        await audit(client, req.user!.id, "schedule.generate", "staff", req.params.id, { from, to, ...counts });
        return counts;
      });
      return result;
    },
  );

  app.get<{ Params: { id: number }; Querystring: { from: string; to: string } }>(
    "/api/staff/:id/schedules",
    {
      preHandler: guards.read,
      schema: {
        params: idParams,
        querystring: { type: "object", required: ["from", "to"], properties: { from: isoDate, to: isoDate } },
      },
    },
    async (req) => {
      const { rows } = await db.query(
        `SELECT * FROM schedules
          WHERE staff_id = $1
            AND ends_at > ($2::date)::timestamp AT TIME ZONE '${CLINIC_TZ}'
            AND starts_at < ($3::date + 1)::timestamp AT TIME ZONE '${CLINIC_TZ}'
          ORDER BY starts_at`,
        [req.params.id, req.query.from, req.query.to],
      );
      return rows.map((r) => ({
        id: r.id,
        staffId: r.staff_id,
        siteId: r.site_id,
        startsAt: (r.starts_at as Date).toISOString(),
        endsAt: (r.ends_at as Date).toISOString(),
        kind: r.kind,
      }));
    },
  );

  // --- public: for the reception bot and the website ---------------------------------------
  const publicRange = {
    type: "object",
    properties: { from: isoDate, days: { type: "integer", minimum: 1, maximum: MAX_PUBLIC_DAYS } },
  } as const;

  // Opening hours of every site: the regular week plus the effective hours day by day
  // (holidays and changed days applied), from `from` (default: today in the clinic) for `days` days.
  app.get<{ Querystring: { from?: string; days?: number } }>(
    "/api/public/opening-hours",
    { schema: { querystring: publicRange } },
    async (req, reply) => {
      allowPublic(req, reply, publicOrigins);
      const days = req.query.days ?? 14;
      const [{ rows }, now, sites] = await Promise.all([
        db.query(
          `WITH range AS (
             SELECT d::date AS day
               FROM generate_series(COALESCE($1::date, (now() AT TIME ZONE '${CLINIC_TZ}')::date),
                                    COALESCE($1::date, (now() AT TIME ZONE '${CLINIC_TZ}')::date) + ($2::int - 1),
                                    interval '1 day') d)
           SELECT s.id AS site_id, r.day, extract(isodow FROM r.day)::int AS weekday,
                  e.day IS NOT NULL AS changed, e.opens AS e_opens, e.closes AS e_closes, e.note,
                  h.opens, h.closes
             FROM sites s CROSS JOIN range r
             LEFT JOIN opening_exceptions e ON e.site_id = s.id AND e.day = r.day
             LEFT JOIN opening_hours h ON h.site_id = s.id AND h.weekday = extract(isodow FROM r.day)
            ORDER BY s.id, r.day`,
          [req.query.from ?? null, days],
        ),
        db.query<{ day: string; time: string }>(
          `SELECT to_char(now() AT TIME ZONE '${CLINIC_TZ}', 'YYYY-MM-DD') AS day,
                  to_char(now() AT TIME ZONE '${CLINIC_TZ}', 'HH24:MI') AS time`,
        ),
        openingHours(),
      ]);
      const { day: today, time } = now.rows[0];
      return {
        timezone: CLINIC_TZ,
        generatedAt: new Date().toISOString(),
        sites: sites.map((s) => {
          const calendar = rows
            .filter((r) => r.site_id === s.id)
            .map((r) => {
              const opens = shortTime(r.changed ? r.e_opens : r.opens);
              const closes = shortTime(r.changed ? r.e_closes : r.closes);
              return {
                date: r.day as string,
                weekday: WEEKDAYS[r.weekday - 1],
                open: opens !== null,
                opens,
                closes,
                note: r.note ?? null,
              };
            });
          const todayRow = calendar.find((d) => d.date === today);
          return {
            id: s.id,
            name: s.name,
            week: WEEKDAYS.map((name, i) => {
              const d = s.week.find((w) => w.weekday === i + 1);
              return { weekday: name, open: !!d, opens: d?.opens ?? null, closes: d?.closes ?? null };
            }),
            openNow: todayRow ? todayRow.open && todayRow.opens! <= time && time < todayRow.closes! : null,
            days: calendar,
          };
        }),
      };
    },
  );

  // Active staff with their working hours day by day (days with an absence left out). No phone or e-mail.
  app.get<{ Querystring: { from?: string; days?: number } }>(
    "/api/public/staff",
    { schema: { querystring: publicRange } },
    async (req, reply) => {
      allowPublic(req, reply, publicOrigins);
      const days = req.query.days ?? 14;
      const [staff, hours] = await Promise.all([
        db.query(`${STAFF_SELECT} WHERE st.active GROUP BY st.id ORDER BY st.sort_order, st.name`),
        db.query(
          `WITH bounds AS (
             SELECT COALESCE($1::date, (now() AT TIME ZONE '${CLINIC_TZ}')::date) AS first)
           SELECT w.staff_id, w.site_id, w.starts_at, w.ends_at
             FROM schedules w, bounds b
            WHERE w.kind = 'work'
              AND w.starts_at >= b.first::timestamp AT TIME ZONE '${CLINIC_TZ}'
              AND w.starts_at < (b.first + $2::int)::timestamp AT TIME ZONE '${CLINIC_TZ}'
              AND NOT EXISTS (SELECT 1 FROM schedules a
                               WHERE a.staff_id = w.staff_id AND a.kind = 'absence'
                                 AND a.starts_at < w.ends_at AND a.ends_at > w.starts_at)
            ORDER BY w.starts_at`,
          [req.query.from ?? null, days],
        ),
      ]);
      const local = new Intl.DateTimeFormat("en-CA", {
        timeZone: CLINIC_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      const parts = (d: Date) => {
        const p = Object.fromEntries(local.formatToParts(d).map((x) => [x.type, x.value]));
        return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
      };
      return {
        timezone: CLINIC_TZ,
        staff: staff.rows.map((s) => ({
          id: s.id,
          name: s.name,
          title: s.title ?? null,
          kind: s.kind,
          sites: s.sites,
          hours: hours.rows
            .filter((h) => h.staff_id === s.id)
            .map((h) => {
              const start = parts(h.starts_at);
              return { date: start.date, siteId: h.site_id, from: start.time, to: parts(h.ends_at).time };
            }),
        })),
      };
    },
  );
}

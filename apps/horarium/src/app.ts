import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { login, logout, ROLES, userForToken, type Role, type User } from "./auth.js";
import { audit, type Db } from "./db.js";
import { createLoginLimiter, type LoginLimiter } from "./login-limit.js";
import { normalizePhone } from "./phone.js";
import { registerServices } from "./services.js";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

const WRITE_ROLES: Role[] = ["admin", "reception"];
const ADMIN: Role[] = ["admin"];
const ALL: Role[] = [...ROLES];

const APPOINTMENT_STATUSES = ["booked", "confirmed", "cancelled", "no_show", "done"] as const;
const PG_EXCLUSION_VIOLATION = "23P01";
const PG_UNIQUE_VIOLATION = "23505";
const PG_FK_VIOLATION = "23503";
const MAX_RANGE_DAYS = 42;

const isoDateTime = { type: "string", format: "date-time" } as const;

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)session=([^;]+)/);
  return cookie ? decodeURIComponent(cookie[1]) : null;
}

function guard(roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "Zaloguj się." });
    if (!roles.includes(req.user.role)) return reply.code(403).send({ error: "Brak uprawnień." });
  };
}

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
}

function patientRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    email: r.email,
    birthDate: r.birth_date,
    medicalFlags: r.medical_flags,
    notes: r.notes,
    smsConsent: r.sms_consent,
  };
}

/** Search results: enough to pick the right person. Notes and medical flags only come with the full card. */
function patientSummary(r: Record<string, unknown>) {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    birthDate: r.birth_date,
  };
}

function noFields(): never {
  throw Object.assign(new Error("Brak pól do zmiany."), { statusCode: 400 });
}

function appointmentRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    siteId: r.site_id,
    staffId: r.staff_id,
    patientId: r.patient_id,
    patientName: r.patient_name ?? null,
    serviceId: r.service_id,
    serviceName: r.service_name ?? null,
    title: r.title,
    startsAt: (r.starts_at as Date).toISOString(),
    endsAt: (r.ends_at as Date).toISOString(),
    status: r.status,
    source: r.source,
    notes: r.notes,
  };
}

const APPOINTMENT_SELECT = `
  SELECT a.*, s.name AS service_name,
         CASE WHEN p.id IS NULL THEN NULL ELSE p.first_name || ' ' || p.last_name END AS patient_name
    FROM appointments a
    LEFT JOIN services s ON s.id = a.service_id
    LEFT JOIN patients p ON p.id = a.patient_id`;

export interface AppOptions {
  logger?: boolean;
  /** Built reception UI to serve, if any. */
  webRoot?: string;
  /** Origins allowed to read the public price list from a browser (the clinic website). */
  publicOrigins?: string[];
  /** Failed-login limiter; tests pass their own. */
  loginLimiter?: LoginLimiter;
}

// Request logs keep the path only: search queries (?q=surname or phone) must not land in log files.
const LOG_SERIALIZERS = {
  req: (req: { method: string; url: string; ip?: string }) => ({
    method: req.method,
    url: req.url.split("?")[0],
    remoteAddress: req.ip,
  }),
};

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ? { serializers: LOG_SERIALIZERS } : false });
  const limiter = opts.loginLimiter ?? createLoginLimiter();

  // The reception UI is a static build served by this same process: one service to run and watch.
  if (opts.webRoot) {
    app.register(fastifyStatic, { root: opts.webRoot });
    app.setNotFoundHandler((req, reply) =>
      req.method === "GET" && !req.url.startsWith("/api/")
        ? reply.sendFile("index.html")
        : reply.code(404).send({ error: "Nie znaleziono." }),
    );
  }

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => {
    const token = bearer(req);
    req.user = token ? await userForToken(db, token) : null;
  });

  app.setErrorHandler((error, _req, reply) => {
    const code = pgCode(error);
    if (code === PG_EXCLUSION_VIOLATION) {
      return reply.code(409).send({ error: "Ten lekarz ma już wizytę w tym czasie." });
    }
    if (code === PG_UNIQUE_VIOLATION) return reply.code(409).send({ error: "Taki wpis już istnieje." });
    if (code === PG_FK_VIOLATION) return reply.code(400).send({ error: "Nieznany pacjent, lekarz, usługa lub placówka." });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply.code(status).send({ error: status >= 500 ? "Błąd serwera." : (error as Error).message });
  });

  app.get("/health", async () => ({ ok: true, service: "horarium" }));

  // --- auth -------------------------------------------------------------------------------
  app.post<{ Body: { login: string; password: string } }>(
    "/api/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["login", "password"],
          properties: { login: { type: "string", minLength: 1 }, password: { type: "string", minLength: 1 } },
        },
      },
    },
    async (req, reply) => {
      const wait = limiter.retryAfter(req.ip, req.body.login);
      if (wait) {
        reply.header("retry-after", String(wait));
        return reply
          .code(429)
          .send({ error: `Za dużo nieudanych prób. Spróbuj za ${Math.ceil(wait / 60)} min.` });
      }
      const result = await login(db, req.body.login, req.body.password);
      if (!result) {
        limiter.fail(req.ip, req.body.login);
        await audit(db, null, "auth.failed", "login", req.body.login.toLowerCase().slice(0, 64), { ip: req.ip });
        return reply.code(401).send({ error: "Zły login lub hasło." });
      }
      limiter.succeed(req.ip, req.body.login);
      await audit(db, result.user.id, "auth.login", "user", result.user.id);
      reply.header("set-cookie", `session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
      return result;
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    const token = bearer(req);
    if (token) await logout(db, token);
    reply.header("set-cookie", "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return { ok: true };
  });

  app.get("/api/me", { preHandler: guard(ALL) }, async (req) => req.user);

  // --- reference data ---------------------------------------------------------------------
  app.get("/api/sites", { preHandler: guard(ALL) }, async () => (await db.query("SELECT * FROM sites ORDER BY name")).rows);

  app.get("/api/staff", { preHandler: guard(ALL) }, async () => {
    const { rows } = await db.query(
      `SELECT st.id, st.name, st.kind, st.active, COALESCE(array_agg(ss.site_id ORDER BY ss.site_id)
              FILTER (WHERE ss.site_id IS NOT NULL), '{}') AS sites
         FROM staff st LEFT JOIN staff_sites ss ON ss.staff_id = st.id
        GROUP BY st.id ORDER BY st.name`,
    );
    return rows;
  });

  app.post<{ Body: { name: string; kind?: "person" | "calendar"; sites: string[] } }>(
    "/api/staff",
    {
      preHandler: guard(ADMIN),
      schema: {
        body: {
          type: "object",
          required: ["name", "sites"],
          properties: {
            name: { type: "string", minLength: 1 },
            kind: { enum: ["person", "calendar"] },
            sites: { type: "array", items: { type: "string" }, minItems: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ id: number }>(
          "INSERT INTO staff (name, kind) VALUES ($1, $2) RETURNING id",
          [req.body.name, req.body.kind ?? "person"],
        );
        for (const site of req.body.sites) {
          await client.query("INSERT INTO staff_sites (staff_id, site_id) VALUES ($1, $2)", [rows[0].id, site]);
        }
        await audit(client, req.user!.id, "staff.create", "staff", rows[0].id, req.body);
        await client.query("COMMIT");
        return reply.code(201).send({ id: rows[0].id });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  registerServices(app, db, { read: guard(ALL), admin: guard(ADMIN) }, opts.publicOrigins ?? []);

  // --- patients ---------------------------------------------------------------------------
  app.get<{ Querystring: { q?: string; limit?: number } }>(
    "/api/patients",
    {
      preHandler: guard(ALL),
      schema: {
        querystring: {
          type: "object",
          properties: { q: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
        },
      },
    },
    async (req) => {
      const q = (req.query.q ?? "").trim();
      const limit = req.query.limit ?? 30;
      if (!q) return [];
      const phone = normalizePhone(q);
      const { rows } = await db.query(
        `SELECT * FROM patients
          WHERE ($1::text IS NOT NULL AND phone = $1)
             OR lower(last_name || ' ' || first_name) LIKE $2
             OR lower(first_name || ' ' || last_name) LIKE $2
          ORDER BY last_name, first_name LIMIT $3`,
        [phone, `${q.toLowerCase()}%`, limit],
      );
      return rows.map(patientSummary);
    },
  );

  app.get<{ Params: { id: number } }>(
    "/api/patients/:id",
    { preHandler: guard(ALL), schema: { params: { type: "object", properties: { id: { type: "integer" } } } } },
    async (req, reply) => {
      const { rows } = await db.query("SELECT * FROM patients WHERE id = $1", [req.params.id]);
      if (!rows[0]) return reply.code(404).send({ error: "Nie ma takiego pacjenta." });
      // Opening a card is logged too: who looked at which patient's data, and when.
      await audit(db, req.user!.id, "patient.view", "patient", req.params.id);
      const visits = await db.query(`${APPOINTMENT_SELECT} WHERE a.patient_id = $1 ORDER BY a.starts_at DESC`, [
        req.params.id,
      ]);
      return { ...patientRow(rows[0]), appointments: visits.rows.map(appointmentRow) };
    },
  );

  const patientProps = {
    firstName: { type: "string", minLength: 1 },
    lastName: { type: "string", minLength: 1 },
    phone: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    birthDate: { type: ["string", "null"], format: "date" },
    medicalFlags: { type: "array", items: { type: "string" } },
    notes: { type: ["string", "null"] },
    smsConsent: { type: "boolean" },
  } as const;
  const patientColumns: Record<string, string> = {
    firstName: "first_name",
    lastName: "last_name",
    phone: "phone",
    email: "email",
    birthDate: "birth_date",
    medicalFlags: "medical_flags",
    notes: "notes",
    smsConsent: "sms_consent",
  };
  type PatientBody = Partial<{
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    birthDate: string | null;
    medicalFlags: string[];
    notes: string | null;
    smsConsent: boolean;
  }>;

  function cleanPatient(body: PatientBody): PatientBody {
    const out = { ...body };
    if (typeof out.phone === "string") {
      const phone = normalizePhone(out.phone);
      if (!phone) throw Object.assign(new Error("Nieprawidłowy numer telefonu."), { statusCode: 400 });
      out.phone = phone;
    }
    return out;
  }

  app.post<{ Body: PatientBody }>(
    "/api/patients",
    {
      preHandler: guard(WRITE_ROLES),
      schema: { body: { type: "object", required: ["firstName", "lastName"], properties: patientProps } },
    },
    async (req, reply) => {
      const body = cleanPatient(req.body);
      const keys = Object.keys(body).filter((k) => k in patientColumns) as (keyof PatientBody)[];
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO patients (${keys.map((k) => patientColumns[k]).join(", ")})
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        keys.map((k) => body[k]),
      );
      await audit(db, req.user!.id, "patient.create", "patient", rows[0].id);
      return reply.code(201).send({ id: rows[0].id });
    },
  );

  app.patch<{ Params: { id: number }; Body: PatientBody }>(
    "/api/patients/:id",
    {
      preHandler: guard(WRITE_ROLES),
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
        body: { type: "object", properties: patientProps, minProperties: 1 },
      },
    },
    async (req, reply) => {
      const body = cleanPatient(req.body);
      const keys = Object.keys(body).filter((k) => k in patientColumns) as (keyof PatientBody)[];
      if (!keys.length) noFields();
      const { rowCount } = await db.query(
        `UPDATE patients SET ${keys.map((k, i) => `${patientColumns[k]} = $${i + 2}`).join(", ")}, updated_at = now()
          WHERE id = $1`,
        [req.params.id, ...keys.map((k) => body[k])],
      );
      if (!rowCount) return reply.code(404).send({ error: "Nie ma takiego pacjenta." });
      // Field names only: the change log must not copy medical content around.
      await audit(db, req.user!.id, "patient.update", "patient", req.params.id, { fields: keys });
      return { ok: true };
    },
  );

  // Change log of one patient: edits and views of the card, plus changes to their visits. Admin only.
  app.get<{ Params: { id: number } }>(
    "/api/patients/:id/history",
    { preHandler: guard(ADMIN), schema: { params: { type: "object", properties: { id: { type: "integer" } } } } },
    async (req) => {
      const { rows } = await db.query(
        `SELECT l.id, l.at, l.action, l.entity, l.entity_id, l.changes, u.name AS user_name
           FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
          WHERE (l.entity = 'patient' AND l.entity_id = $1)
             OR (l.entity = 'appointment'
                 AND l.entity_id IN (SELECT id::text FROM appointments WHERE patient_id = $2))
          ORDER BY l.at DESC, l.id DESC
          LIMIT 200`,
        [String(req.params.id), req.params.id],
      );
      return rows.map((r) => ({
        id: Number(r.id),
        at: (r.at as Date).toISOString(),
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        changes: r.changes,
        userName: r.user_name,
      }));
    },
  );

  // --- schedules --------------------------------------------------------------------------
  app.get<{ Querystring: { site: string; from: string; to: string } }>(
    "/api/schedules",
    {
      preHandler: guard(ALL),
      schema: {
        querystring: {
          type: "object",
          required: ["site", "from", "to"],
          properties: { site: { type: "string" }, from: isoDateTime, to: isoDateTime },
        },
      },
    },
    async (req) => {
      const { rows } = await db.query(
        "SELECT * FROM schedules WHERE site_id = $1 AND starts_at < $3 AND ends_at > $2 ORDER BY starts_at",
        [req.query.site, req.query.from, req.query.to],
      );
      return rows.map((r) => ({
        id: r.id,
        staffId: r.staff_id,
        siteId: r.site_id,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
        kind: r.kind,
      }));
    },
  );

  app.post<{ Body: { staffId: number; siteId: string; startsAt: string; endsAt: string; kind?: "work" | "absence" } }>(
    "/api/schedules",
    {
      preHandler: guard(WRITE_ROLES),
      schema: {
        body: {
          type: "object",
          required: ["staffId", "siteId", "startsAt", "endsAt"],
          properties: {
            staffId: { type: "integer" },
            siteId: { type: "string" },
            startsAt: isoDateTime,
            endsAt: isoDateTime,
            kind: { enum: ["work", "absence"] },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      if (new Date(b.endsAt) <= new Date(b.startsAt)) return reply.code(400).send({ error: "Koniec przed początkiem." });
      const { rows } = await db.query<{ id: number }>(
        "INSERT INTO schedules (staff_id, site_id, starts_at, ends_at, kind) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [b.staffId, b.siteId, b.startsAt, b.endsAt, b.kind ?? "work"],
      );
      await audit(db, req.user!.id, "schedule.create", "schedule", rows[0].id, b);
      return reply.code(201).send({ id: rows[0].id });
    },
  );

  app.delete<{ Params: { id: number } }>(
    "/api/schedules/:id",
    { preHandler: guard(WRITE_ROLES), schema: { params: { type: "object", properties: { id: { type: "integer" } } } } },
    async (req, reply) => {
      const { rowCount } = await db.query("DELETE FROM schedules WHERE id = $1", [req.params.id]);
      if (!rowCount) return reply.code(404).send({ error: "Nie ma takiego wpisu." });
      await audit(db, req.user!.id, "schedule.delete", "schedule", req.params.id);
      return { ok: true };
    },
  );

  // --- appointments -----------------------------------------------------------------------
  app.get<{ Querystring: { site: string; from: string; to: string; staffId?: number } }>(
    "/api/appointments",
    {
      preHandler: guard(ALL),
      schema: {
        querystring: {
          type: "object",
          required: ["site", "from", "to"],
          properties: { site: { type: "string" }, from: isoDateTime, to: isoDateTime, staffId: { type: "integer" } },
        },
      },
    },
    async (req, reply) => {
      const { site, from, to, staffId } = req.query;
      if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
        return reply.code(400).send({ error: `Zakres najwyżej ${MAX_RANGE_DAYS} dni.` });
      }
      const { rows } = await db.query(
        `${APPOINTMENT_SELECT}
          WHERE a.site_id = $1 AND a.starts_at < $3 AND a.ends_at > $2 AND ($4::int IS NULL OR a.staff_id = $4)
          ORDER BY a.starts_at`,
        [site, from, to, staffId ?? null],
      );
      return rows.map(appointmentRow);
    },
  );

  async function scheduleWarnings(staffId: number, siteId: string, startsAt: string, endsAt: string) {
    const warnings: string[] = [];
    const { rows } = await db.query(
      `SELECT
         EXISTS (SELECT 1 FROM staff_sites WHERE staff_id = $1 AND site_id = $2) AS at_site,
         EXISTS (SELECT 1 FROM schedules WHERE staff_id = $1 AND site_id = $2 AND kind = 'work'
                  AND starts_at <= $3 AND ends_at >= $4) AS in_hours,
         EXISTS (SELECT 1 FROM schedules WHERE staff_id = $1 AND kind = 'absence'
                  AND starts_at < $4 AND ends_at > $3) AS absent`,
      [staffId, siteId, startsAt, endsAt],
    );
    const r = rows[0];
    if (!r.at_site) warnings.push("Ten lekarz nie pracuje w tej placówce.");
    if (!r.in_hours) warnings.push("Poza godzinami pracy z grafiku.");
    if (r.absent) warnings.push("Lekarz ma w tym czasie nieobecność.");
    return warnings;
  }

  async function serviceDuration(serviceId: number | null | undefined): Promise<number | null> {
    if (!serviceId) return null;
    const { rows } = await db.query("SELECT duration_minutes FROM services WHERE id = $1", [serviceId]);
    if (!rows[0]) throw Object.assign(new Error("Nieznana usługa."), { statusCode: 400 });
    return rows[0].duration_minutes;
  }

  type AppointmentBody = {
    siteId: string;
    staffId: number;
    patientId?: number | null;
    serviceId?: number | null;
    title?: string | null;
    startsAt: string;
    endsAt?: string;
    notes?: string | null;
    source?: "desk" | "bot";
  };

  app.post<{ Body: AppointmentBody }>(
    "/api/appointments",
    {
      preHandler: guard(WRITE_ROLES),
      schema: {
        body: {
          type: "object",
          required: ["siteId", "staffId", "startsAt"],
          properties: {
            siteId: { type: "string" },
            staffId: { type: "integer" },
            patientId: { type: ["integer", "null"] },
            serviceId: { type: ["integer", "null"] },
            title: { type: ["string", "null"] },
            startsAt: isoDateTime,
            endsAt: isoDateTime,
            notes: { type: ["string", "null"] },
            source: { enum: ["desk", "bot"] },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      let endsAt = b.endsAt;
      if (!endsAt) {
        const minutes = await serviceDuration(b.serviceId);
        if (!minutes) return reply.code(400).send({ error: "Podaj koniec wizyty albo usługę z cennika." });
        endsAt = new Date(new Date(b.startsAt).getTime() + minutes * 60_000).toISOString();
      }
      if (new Date(endsAt) <= new Date(b.startsAt)) return reply.code(400).send({ error: "Koniec przed początkiem." });
      const warnings = await scheduleWarnings(b.staffId, b.siteId, b.startsAt, endsAt);
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO appointments (site_id, staff_id, patient_id, service_id, title, starts_at, ends_at, notes, source, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          b.siteId,
          b.staffId,
          b.patientId ?? null,
          b.serviceId ?? null,
          b.title ?? null,
          b.startsAt,
          endsAt,
          b.notes ?? null,
          b.source ?? "desk",
          req.user!.id,
        ],
      );
      await audit(db, req.user!.id, "appointment.create", "appointment", rows[0].id, {
        siteId: b.siteId,
        staffId: b.staffId,
        startsAt: b.startsAt,
        endsAt,
      });
      return reply.code(201).send({ id: rows[0].id, endsAt, warnings });
    },
  );

  app.patch<{
    Params: { id: number };
    Body: Partial<{ staffId: number; siteId: string; startsAt: string; endsAt: string; status: string; notes: string | null; serviceId: number | null; title: string | null }>;
  }>(
    "/api/appointments/:id",
    {
      preHandler: guard(WRITE_ROLES),
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
        body: {
          type: "object",
          minProperties: 1,
          properties: {
            staffId: { type: "integer" },
            siteId: { type: "string" },
            startsAt: isoDateTime,
            endsAt: isoDateTime,
            status: { enum: APPOINTMENT_STATUSES },
            notes: { type: ["string", "null"] },
            serviceId: { type: ["integer", "null"] },
            title: { type: ["string", "null"] },
          },
        },
      },
    },
    async (req, reply) => {
      const current = (await db.query("SELECT * FROM appointments WHERE id = $1", [req.params.id])).rows[0];
      if (!current) return reply.code(404).send({ error: "Nie ma takiej wizyty." });
      const b = req.body;
      const next = {
        staffId: b.staffId ?? current.staff_id,
        siteId: b.siteId ?? current.site_id,
        startsAt: b.startsAt ?? current.starts_at.toISOString(),
        endsAt: b.endsAt ?? current.ends_at.toISOString(),
        status: b.status ?? current.status,
        notes: b.notes === undefined ? current.notes : b.notes,
        serviceId: b.serviceId === undefined ? current.service_id : b.serviceId,
        title: b.title === undefined ? current.title : b.title,
      };
      // Moving keeps the visit length unless a new end is given.
      if (b.startsAt && !b.endsAt) {
        const length = current.ends_at.getTime() - current.starts_at.getTime();
        next.endsAt = new Date(new Date(b.startsAt).getTime() + length).toISOString();
      }
      if (new Date(next.endsAt) <= new Date(next.startsAt)) return reply.code(400).send({ error: "Koniec przed początkiem." });
      const moved = b.startsAt || b.endsAt || b.staffId || b.siteId;
      const warnings = moved ? await scheduleWarnings(next.staffId, next.siteId, next.startsAt, next.endsAt) : [];
      await db.query(
        `UPDATE appointments SET staff_id = $2, site_id = $3, starts_at = $4, ends_at = $5, status = $6, notes = $7,
                service_id = $8, title = $9, updated_at = now() WHERE id = $1`,
        [req.params.id, next.staffId, next.siteId, next.startsAt, next.endsAt, next.status, next.notes, next.serviceId, next.title],
      );
      await audit(db, req.user!.id, "appointment.update", "appointment", req.params.id, {
        fields: Object.keys(b),
        status: b.status,
        startsAt: b.startsAt ? next.startsAt : undefined,
      });
      return { ok: true, endsAt: next.endsAt, warnings };
    },
  );

  return app;
}

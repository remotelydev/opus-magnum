// Patient registration on the clinic iPads, and the reception inbox it feeds.
//
// The iPad needs no staff login: reception pairs it once (their login and password, typed on the
// iPad), and from then on it carries only a device token in an HttpOnly cookie scoped to
// /api/kiosk. That token can fetch the form and send answers, nothing else: no patient data ever
// goes back to the tablet. Reception reviews each registration and creates or attaches a card.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { checkCredentials, hashToken, newToken, type User } from "./auth.js";
import { audit, type Db } from "./db.js";
import { FORM, toPatient, validateAnswers, type Answers } from "./intake-form.js";
import type { LoginLimiter } from "./login-limit.js";

const KIOSK_COOKIE = "kiosk";
// Browsers cap cookie lifetime at 400 days; reception can revoke a tablet at any time.
const KIOSK_MAX_AGE = 400 * 24 * 3600;
/** Sending more than this from one tablet in an hour is not patients filling in a form. */
export const KIOSK_HOURLY_LIMIT = 30;
const PAIR_ROLES = ["admin", "reception"];

interface Device {
  id: number;
  name: string;
  siteId: string;
  siteName: string;
}

function kioskToken(req: FastifyRequest): string | null {
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)kiosk=([^;]+)/);
  return cookie ? decodeURIComponent(cookie[1]) : null;
}

const kioskCookie = (token: string, maxAge: number) =>
  `${KIOSK_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/kiosk; Max-Age=${maxAge}`;

function submissionSummary(r: Record<string, unknown>) {
  return {
    id: r.id,
    createdAt: (r.created_at as Date).toISOString(),
    siteId: r.site_id,
    deviceName: r.device_name ?? null,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    birthDate: r.birth_date,
    status: r.status,
    patientId: r.patient_id,
  };
}

const idParams = { type: "object", properties: { id: { type: "integer" } } } as const;
const credentials = {
  login: { type: "string", minLength: 1, maxLength: 64 },
  password: { type: "string", minLength: 1, maxLength: 200 },
} as const;

export function registerIntake(
  app: FastifyInstance,
  db: Db,
  guards: { desk: preHandlerAsyncHookHandler },
  limiter: LoginLimiter,
) {
  async function deviceFor(req: FastifyRequest): Promise<Device | null> {
    const token = kioskToken(req);
    if (!token) return null;
    const { rows } = await db.query(
      `UPDATE kiosk_devices d SET last_seen_at = now()
         FROM sites s
        WHERE d.token_hash = $1 AND d.revoked_at IS NULL AND s.id = d.site_id
        RETURNING d.id, d.name, d.site_id, s.name AS site_name`,
      [hashToken(token)],
    );
    const r = rows[0];
    return r ? { id: r.id, name: r.name, siteId: r.site_id, siteName: r.site_name } : null;
  }

  /** Staff login and password typed on the tablet, with the same lockout as the login screen. */
  async function staffOnTablet(req: FastifyRequest, reply: FastifyReply, login: string, password: string): Promise<User | null> {
    const wait = limiter.retryAfter(req.ip, login);
    if (wait) {
      reply.header("retry-after", String(wait));
      reply.code(429).send({ error: `Za dużo nieudanych prób. Spróbuj za ${Math.ceil(wait / 60)} min.` });
      return null;
    }
    const user = await checkCredentials(db, login, password);
    if (!user) {
      limiter.fail(req.ip, login);
      await audit(db, null, "auth.failed", "login", login.toLowerCase().slice(0, 64), { ip: req.ip, kiosk: true });
      reply.code(401).send({ error: "Zły login lub hasło." });
      return null;
    }
    limiter.succeed(req.ip, login);
    if (!PAIR_ROLES.includes(user.role)) {
      reply.code(403).send({ error: "Tablet może uruchomić recepcja albo administrator." });
      return null;
    }
    return user;
  }

  // --- the tablet -------------------------------------------------------------------------
  app.get("/api/kiosk/state", async (req) => {
    const device = await deviceFor(req);
    if (!device) {
      // Site names only, so whoever pairs the tablet can pick where it stands.
      const sites = await db.query("SELECT id, name FROM sites ORDER BY name");
      return { paired: false, sites: sites.rows };
    }
    return { paired: true, device: { name: device.name, siteName: device.siteName }, form: FORM };
  });

  app.post<{ Body: { login: string; password: string; siteId: string; name: string } }>(
    "/api/kiosk/pair",
    {
      schema: {
        body: {
          type: "object",
          required: ["login", "password", "siteId", "name"],
          properties: { ...credentials, siteId: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 60 } },
        },
      },
    },
    async (req, reply) => {
      const user = await staffOnTablet(req, reply, req.body.login, req.body.password);
      if (!user) return reply;
      const { token, hash } = newToken();
      const { rows } = await db.query<{ id: number }>(
        "INSERT INTO kiosk_devices (name, site_id, token_hash, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
        [req.body.name.trim(), req.body.siteId, hash, user.id],
      );
      await audit(db, user.id, "kiosk.pair", "kiosk_device", rows[0].id, { name: req.body.name.trim(), siteId: req.body.siteId });
      reply.header("set-cookie", kioskCookie(token, KIOSK_MAX_AGE));
      return reply.code(201).send({ ok: true });
    },
  );

  // Switching the tablet back to normal use also needs a staff login, so a patient cannot do it.
  app.post<{ Body: { login: string; password: string } }>(
    "/api/kiosk/unpair",
    { schema: { body: { type: "object", required: ["login", "password"], properties: credentials } } },
    async (req, reply) => {
      const device = await deviceFor(req);
      if (!device) return reply.code(401).send({ error: "Ten tablet nie jest sparowany." });
      const user = await staffOnTablet(req, reply, req.body.login, req.body.password);
      if (!user) return reply;
      await db.query("UPDATE kiosk_devices SET revoked_at = now() WHERE id = $1", [device.id]);
      await audit(db, user.id, "kiosk.revoke", "kiosk_device", device.id);
      reply.header("set-cookie", kioskCookie("", 0));
      return { ok: true };
    },
  );

  app.post<{ Body: { answers: Answers } }>(
    "/api/kiosk/submissions",
    {
      bodyLimit: 64 * 1024,
      schema: { body: { type: "object", required: ["answers"], properties: { answers: { type: "object" } } } },
    },
    async (req, reply) => {
      const device = await deviceFor(req);
      if (!device) return reply.code(401).send({ error: "Ten tablet nie jest sparowany. Poproś o pomoc w recepcji." });
      const recent = await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM intake_submissions WHERE device_id = $1 AND created_at > now() - interval '1 hour'",
        [device.id],
      );
      if (recent.rows[0].n >= KIOSK_HOURLY_LIMIT) {
        return reply.code(429).send({ error: "Formularz jest chwilowo niedostępny. Poproś o pomoc w recepcji." });
      }
      const { values, errors } = validateAnswers(FORM, req.body.answers ?? {});
      if (Object.keys(errors).length) return reply.code(400).send({ error: "Popraw zaznaczone pola.", fields: errors });
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO intake_submissions (device_id, site_id, form_version, first_name, last_name, phone, birth_date, answers)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          device.id,
          device.siteId,
          FORM.version,
          values.firstName,
          values.lastName,
          values.phone ?? null,
          values.birthDate ?? null,
          JSON.stringify(values),
        ],
      );
      // No content in the log: only which tablet sent which registration.
      await audit(db, null, "intake.submit", "intake", rows[0].id, { deviceId: device.id });
      // Nothing about the patient comes back: the next person at the tablet must not see it.
      return reply.code(201).send({ ok: true });
    },
  );

  // --- reception --------------------------------------------------------------------------
  app.get<{ Querystring: { status?: "new" | "accepted" } }>(
    "/api/intake",
    {
      preHandler: guards.desk,
      schema: { querystring: { type: "object", properties: { status: { enum: ["new", "accepted"] } } } },
    },
    async (req) => {
      const status = req.query.status ?? "new";
      const { rows } = await db.query(
        `SELECT i.*, d.name AS device_name FROM intake_submissions i
           LEFT JOIN kiosk_devices d ON d.id = i.device_id
          WHERE i.status = $1
          ORDER BY i.created_at DESC
          LIMIT 200`,
        [status],
      );
      return rows.map(submissionSummary);
    },
  );

  app.get<{ Params: { id: number } }>(
    "/api/intake/:id",
    { preHandler: guards.desk, schema: { params: idParams } },
    async (req, reply) => {
      const { rows } = await db.query(
        `SELECT i.*, d.name AS device_name FROM intake_submissions i
           LEFT JOIN kiosk_devices d ON d.id = i.device_id WHERE i.id = $1`,
        [req.params.id],
      );
      const r = rows[0];
      if (!r) return reply.code(404).send({ error: "Nie ma takiej rejestracji." });
      await audit(db, req.user!.id, "intake.view", "intake", req.params.id);
      // Cards that may be the same person: same phone, or same name and birth date.
      const matches = await db.query(
        `SELECT id, first_name, last_name, phone, birth_date FROM patients
          WHERE ($1::text IS NOT NULL AND phone = $1)
             OR (lower(first_name) = lower($2) AND lower(last_name) = lower($3) AND birth_date IS NOT DISTINCT FROM $4::date)
          ORDER BY last_name, first_name LIMIT 10`,
        [r.phone, r.first_name, r.last_name, r.birth_date],
      );
      return {
        ...submissionSummary(r),
        formVersion: r.form_version,
        answers: r.answers,
        draft: toPatient(FORM, r.answers),
        matches: matches.rows.map((m) => ({
          id: m.id,
          firstName: m.first_name,
          lastName: m.last_name,
          phone: m.phone,
          birthDate: m.birth_date,
        })),
      };
    },
  );

  // Creates a card from the registration, or attaches it to an existing card: then empty contact
  // fields are filled in, medical flags are added (never removed), and notes get the new answers.
  app.post<{ Params: { id: number }; Body: { patientId?: number } }>(
    "/api/intake/:id/accept",
    {
      preHandler: guards.desk,
      schema: { params: idParams, body: { type: "object", properties: { patientId: { type: "integer" } } } },
    },
    async (req, reply) => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          "SELECT * FROM intake_submissions WHERE id = $1 AND status = 'new' FOR UPDATE",
          [req.params.id],
        );
        const r = rows[0];
        if (!r) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Tej rejestracji nie ma albo już ją przyjęto." });
        }
        const draft = toPatient(FORM, r.answers);
        const day = new Date(r.created_at).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" });
        const notes = draft.notes.length ? `Ankieta z ${day}: ${draft.notes.join("; ")}` : null;
        let patientId = req.body?.patientId;
        if (patientId) {
          const { rowCount } = await client.query(
            `UPDATE patients SET
               phone = coalesce(phone, $2), email = coalesce(email, $3), birth_date = coalesce(birth_date, $4),
               sms_consent = $5,
               medical_flags = ARRAY(SELECT DISTINCT unnest(medical_flags || $6::text[])),
               notes = CASE WHEN $7::text IS NULL THEN notes
                            WHEN coalesce(notes, '') = '' THEN $7
                            ELSE notes || E'\\n' || $7 END,
               updated_at = now()
             WHERE id = $1`,
            [patientId, draft.phone, draft.email, draft.birthDate, draft.smsConsent, draft.medicalFlags, notes],
          );
          if (!rowCount) {
            await client.query("ROLLBACK");
            return reply.code(404).send({ error: "Nie ma takiego pacjenta." });
          }
          await audit(client, req.user!.id, "patient.update", "patient", patientId, { fields: ["intake"], intakeId: r.id });
        } else {
          const created = await client.query<{ id: number }>(
            `INSERT INTO patients (first_name, last_name, phone, email, birth_date, sms_consent, medical_flags, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [draft.firstName, draft.lastName, draft.phone, draft.email, draft.birthDate, draft.smsConsent, draft.medicalFlags, notes],
          );
          patientId = created.rows[0].id;
          await audit(client, req.user!.id, "patient.create", "patient", patientId, { intakeId: r.id });
        }
        await client.query(
          "UPDATE intake_submissions SET status = 'accepted', patient_id = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1",
          [r.id, patientId, req.user!.id],
        );
        await audit(client, req.user!.id, "intake.accept", "intake", r.id, { patientId });
        await client.query("COMMIT");
        return { ok: true, patientId };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  );

  // Test entries, duplicates, a patient who gave up halfway and asked to start over.
  app.delete<{ Params: { id: number } }>(
    "/api/intake/:id",
    { preHandler: guards.desk, schema: { params: idParams } },
    async (req, reply) => {
      const { rowCount } = await db.query("DELETE FROM intake_submissions WHERE id = $1 AND status = 'new'", [req.params.id]);
      if (!rowCount) return reply.code(404).send({ error: "Tej rejestracji nie ma albo już ją przyjęto." });
      await audit(db, req.user!.id, "intake.delete", "intake", req.params.id);
      return { ok: true };
    },
  );

  app.get("/api/kiosk-devices", { preHandler: guards.desk }, async () => {
    const { rows } = await db.query(
      `SELECT d.id, d.name, d.site_id, d.created_at, d.last_seen_at, u.name AS created_by_name
         FROM kiosk_devices d LEFT JOIN users u ON u.id = d.created_by
        WHERE d.revoked_at IS NULL ORDER BY d.created_at`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      siteId: r.site_id,
      createdAt: (r.created_at as Date).toISOString(),
      lastSeenAt: r.last_seen_at ? (r.last_seen_at as Date).toISOString() : null,
      createdByName: r.created_by_name,
    }));
  });

  app.delete<{ Params: { id: number } }>(
    "/api/kiosk-devices/:id",
    { preHandler: guards.desk, schema: { params: idParams } },
    async (req, reply) => {
      const { rowCount } = await db.query(
        "UPDATE kiosk_devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
        [req.params.id],
      );
      if (!rowCount) return reply.code(404).send({ error: "Nie ma takiego tabletu." });
      await audit(db, req.user!.id, "kiosk.revoke", "kiosk_device", req.params.id);
      return { ok: true };
    },
  );
}

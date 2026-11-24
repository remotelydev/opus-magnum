// Versum reports the clinic does not use yet, kept for the logins with the 'hidden_reports' feature
// (Bartosz): where patients came from ("Pochodzenie klientów") and staff commissions ("Prowizje").
// Everyone else gets 403 and the screens do not show them.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { audit, type Db } from "./db.js";

const TZ = "Europe/Warsaw";
const ALL_SITES = "all";
const MAX_RANGE_DAYS = 3 * 366;
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const rangeSchema = {
  querystring: {
    type: "object",
    required: ["site", "from", "to"],
    properties: { site: { type: "string" }, from: DATE, to: DATE },
  },
} as const;
const idParams = { type: "object", properties: { id: { type: "integer" } } } as const;

interface Range {
  site: string;
  from: string;
  to: string;
}

const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

/** Done patient visits in whole clinic days from $1 to $2, at clinic $3 (or all). */
const WINDOW = `a.status = 'done' AND a.patient_id IS NOT NULL
  AND a.starts_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}'
  AND a.starts_at < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
  AND ($3 = '${ALL_SITES}' OR a.site_id = $3)`;

/** What was paid per visit. */
const PAID = `LEFT JOIN (SELECT appointment_id, sum(amount) AS amount FROM appointment_payments GROUP BY 1) pay
  ON pay.appointment_id = a.id`;

function checkRange(q: Range, reply: FastifyReply): boolean {
  const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
  if (days < 0) {
    reply.code(400).send({ error: "Koniec zakresu przed początkiem." });
    return false;
  }
  if (days > MAX_RANGE_DAYS) {
    reply.code(400).send({ error: "Zakres najwyżej 3 lata." });
    return false;
  }
  return true;
}

export function registerHiddenReports(app: FastifyInstance, db: Db, guards: { hidden: preHandlerAsyncHookHandler }): void {
  // --- Pochodzenie klientów -------------------------------------------------------------------
  // Per origin (as on the patient card): patients who had a done visit in the range, what they paid and
  // the average per patient. Patients with no origin are one row with origin null.
  app.get<{ Querystring: Range }>(
    "/api/stats/origins",
    { config: { access: "staff" }, preHandler: guards.hidden, schema: rangeSchema },
    async (req, reply) => {
      if (!checkRange(req.query, reply)) return;
      const { rows } = await db.query(
        `SELECT nullif(trim(p.origin), '') AS origin,
                count(DISTINCT a.patient_id)::int AS patients,
                count(*)::int AS visits,
                coalesce(sum(pay.amount), 0)::float AS revenue
           FROM appointments a JOIN patients p ON p.id = a.patient_id ${PAID}
          WHERE ${WINDOW}
          GROUP BY 1 ORDER BY 2 DESC, 1`,
        [req.query.from, req.query.to, req.query.site],
      );
      return rows.map((r) => ({
        origin: (r.origin as string | null) ?? null,
        patients: r.patients as number,
        visits: r.visits as number,
        revenue: money(r.revenue),
        average: r.patients ? money(Number(r.revenue) / Number(r.patients)) : 0,
      }));
    },
  );

  // Origins already in use (most patients first), offered when one is set on a patient card.
  app.get("/api/origins", { config: { access: "staff" }, preHandler: guards.hidden }, async () => {
    const { rows } = await db.query(
      `SELECT trim(origin) AS origin, count(*)::int AS patients FROM patients
        WHERE nullif(trim(origin), '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1`,
    );
    return rows.map((r) => ({ origin: r.origin as string, patients: r.patients as number }));
  });

  app.put<{ Params: { id: number }; Body: { origin: string | null } }>(
    "/api/patients/:id/origin",
    { config: { access: "staff", audited: true },
      preHandler: guards.hidden,
      schema: {
        params: idParams,
        body: { type: "object", required: ["origin"], properties: { origin: { type: ["string", "null"], maxLength: 200 } } },
      },
    },
    async (req: FastifyRequest<{ Params: { id: number }; Body: { origin: string | null } }>, reply) => {
      const origin = req.body.origin?.trim() || null;
      const { rowCount } = await db.query("UPDATE patients SET origin = $2, updated_at = now() WHERE id = $1", [req.params.id, origin]);
      if (!rowCount) return reply.code(404).send({ error: "Nie ma takiego pacjenta." });
      await audit(db, req.user!.id, "patient.update", "patient", req.params.id, { fields: ["origin"] });
      return { ok: true, origin };
    },
  );

  // --- Prowizje pracowników -------------------------------------------------------------------
  // Per staff member and clinic: what was paid for their done visits in the range, their current rate
  // and the commission (paid × rate). Services only: the clinic sells no products through Horarium.
  app.get<{ Querystring: Range }>(
    "/api/stats/commissions",
    { config: { access: "staff" }, preHandler: guards.hidden, schema: rangeSchema },
    async (req, reply) => {
      if (!checkRange(req.query, reply)) return;
      const { rows } = await db.query(
        `SELECT a.staff_id, a.site_id, count(*)::int AS visits,
                coalesce(sum(pay.amount), 0)::float AS revenue,
                coalesce(max(sc.rate), 0)::float AS rate
           FROM appointments a ${PAID}
           LEFT JOIN staff_commissions sc ON sc.staff_id = a.staff_id
          WHERE ${WINDOW}
          GROUP BY 1, 2`,
        [req.query.from, req.query.to, req.query.site],
      );
      return rows.map((r) => ({
        staffId: r.staff_id as number,
        siteId: r.site_id as string,
        visits: r.visits as number,
        revenue: money(r.revenue),
        rate: Number(r.rate),
        commission: money((Number(r.revenue) * Number(r.rate)) / 100),
      }));
    },
  );

  app.get("/api/commissions", { config: { access: "staff" }, preHandler: guards.hidden }, async () => {
    const { rows } = await db.query("SELECT staff_id, rate::float AS rate FROM staff_commissions ORDER BY staff_id");
    return rows.map((r) => ({ staffId: r.staff_id as number, rate: Number(r.rate) }));
  });

  app.put<{ Params: { id: number }; Body: { rate: number } }>(
    "/api/commissions/:id",
    { config: { access: "staff", audited: true },
      preHandler: guards.hidden,
      schema: {
        params: idParams,
        body: { type: "object", required: ["rate"], properties: { rate: { type: "number", minimum: 0, maximum: 100 } } },
      },
    },
    async (req, reply) => {
      const rate = money(req.body.rate);
      const staff = await db.query("SELECT 1 FROM staff WHERE id = $1", [req.params.id]);
      if (!staff.rowCount) return reply.code(404).send({ error: "Nie ma takiego pracownika." });
      await db.query(
        `INSERT INTO staff_commissions (staff_id, rate, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (staff_id) DO UPDATE SET rate = $2, updated_by = $3, updated_at = now()`,
        [req.params.id, rate, req.user!.id],
      );
      await audit(db, req.user!.id, "staff.commission", "staff", req.params.id, { rate });
      return { ok: true, rate };
    },
  );
}

// Statistics as in Versum ("Statystyki"), closing a visit with its services and payment, and the cash
// register of each clinic.
//
// Who sees what: admins see everything; a doctor sees only their own rows (their visits, their money);
// reception and hygienists see no statistics. Closing a visit is reception's and admins' job.
//
// Money: what was paid for a visit (appointment_payments), both entered at the desk and imported from
// Versum. Dental care is VAT-exempt, so there is one amount, no net/gross.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { User } from "./auth.js";
import { audit, type Db } from "./db.js";

const TZ = "Europe/Warsaw";
const ALL_SITES = "all";
export const PAYMENT_METHODS = { cash: "gotówka", card: "karta" } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
/** Longest range a report covers in one go (Versum allows any; a year of the clinic is ~26k visits). */
const MAX_RANGE_DAYS = 3 * 366;
const OFF_LIST = "Usługa spoza cennika";

type Guard = preHandlerAsyncHookHandler;
interface Range {
  site: string;
  from: string;
  to: string;
}
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const rangeSchema = {
  querystring: {
    type: "object",
    required: ["site", "from", "to"],
    properties: { site: { type: "string" }, from: DATE, to: DATE },
  },
} as const;

const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const minutes = (v: unknown) => Math.round(Number(v ?? 0));

/**
 * SQL bounds of a report: whole clinic days from `from` to `to`, the clinic, and the staff member a
 * doctor is limited to. Parameters $1..$4: from, to, site, staff (null = everyone).
 */
const WINDOW = `a.starts_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}'
  AND a.starts_at < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
  AND ($3 = '${ALL_SITES}' OR a.site_id = $3)
  AND ($4::int IS NULL OR a.staff_id = $4)`;

/** The staff member a report is limited to: a doctor's own; null (everyone) for admins. */
function scope(user: User, reply: FastifyReply): { staffId: number | null } | null {
  if (user.role === "admin") return { staffId: null };
  if (user.role === "doctor" && user.staffId) return { staffId: user.staffId };
  reply.code(403).send({ error: "Brak uprawnień." });
  return null;
}

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

function params(q: Range, staffId: number | null) {
  return [q.from, q.to, q.site, staffId];
}

export function registerStatistics(
  app: FastifyInstance,
  db: Db,
  guards: { stats: Guard; admin: Guard; desk: Guard },
): void {
  const read = (req: FastifyRequest<{ Querystring: Range }>, reply: FastifyReply) => {
    const s = scope(req.user!, reply);
    if (!s || !checkRange(req.query, reply)) return null;
    return s;
  };

  // --- Raport finansowy + Aktywność pracowników -----------------------------------------------
  app.get<{ Querystring: Range }>(
    "/api/stats/financial",
    { config: { access: "staff" }, preHandler: guards.stats, schema: rangeSchema },
    async (req, reply) => {
      const s = read(req, reply);
      if (!s) return;
      const p = params(req.query, s.staffId);
      const [staff, methods] = await Promise.all([
        db.query(
          `SELECT a.staff_id, a.site_id,
                  count(*)::int AS visits,
                  sum(extract(epoch FROM a.ends_at - a.starts_at) / 60)::float AS minutes,
                  coalesce(sum(pay.amount), 0)::float AS revenue
             FROM appointments a
             LEFT JOIN (SELECT appointment_id, sum(amount) AS amount FROM appointment_payments GROUP BY 1) pay
                    ON pay.appointment_id = a.id
            WHERE a.status = 'done' AND a.patient_id IS NOT NULL AND ${WINDOW}
            GROUP BY 1, 2`,
          p,
        ),
        db.query(
          `SELECT ap.method, max(ap.method_label) AS label, sum(ap.amount)::float AS amount
             FROM appointment_payments ap JOIN appointments a ON a.id = ap.appointment_id
            WHERE a.status = 'done' AND a.patient_id IS NOT NULL AND ${WINDOW}
            GROUP BY 1 ORDER BY 3 DESC`,
          p,
        ),
      ]);
      const rows = staff.rows.map((r) => ({
        staffId: r.staff_id as number,
        siteId: r.site_id as string,
        visits: r.visits as number,
        minutes: minutes(r.minutes),
        revenue: money(r.revenue),
      }));
      return {
        staff: rows,
        totals: {
          visits: rows.reduce((n, r) => n + r.visits, 0),
          minutes: rows.reduce((n, r) => n + r.minutes, 0),
          revenue: money(rows.reduce((n, r) => n + r.revenue, 0)),
        },
        methods: methods.rows.map((r) => ({
          method: r.method as string,
          label: (r.label as string | null) ?? PAYMENT_METHODS[r.method as PaymentMethod] ?? r.method,
          amount: money(r.amount),
        })),
      };
    },
  );

  // --- Popularność usług ----------------------------------------------------------------------
  // Done visits: the services entered when the visit was closed. A visit with none (all of the Versum
  // history, which the clinic closed as "Usługa spoza cennika") counts as one off-list service with what
  // was paid. Waiting visits (booked or confirmed): the booked service at its price-list price.
  app.get<{ Querystring: Range }>(
    "/api/stats/services",
    { config: { access: "staff" }, preHandler: guards.stats, schema: rangeSchema },
    async (req, reply) => {
      const s = read(req, reply);
      if (!s) return;
      const p = params(req.query, s.staffId);
      const { rows } = await db.query(
        `WITH visits AS (
           SELECT a.id, a.staff_id, a.status, a.service_id,
                  extract(epoch FROM a.ends_at - a.starts_at) / 60 AS minutes,
                  (SELECT count(*) FROM appointment_services x WHERE x.appointment_id = a.id) AS items
             FROM appointments a
            WHERE a.status IN ('done', 'booked', 'confirmed') AND a.patient_id IS NOT NULL AND ${WINDOW}
         ), lines AS (
           SELECT v.staff_id, true AS done, x.service_id, x.name, x.price AS amount, v.minutes / v.items AS minutes
             FROM visits v JOIN appointment_services x ON x.appointment_id = v.id
            WHERE v.status = 'done'
           UNION ALL
           SELECT v.staff_id, true, NULL, NULL,
                  (SELECT coalesce(sum(amount), 0) FROM appointment_payments WHERE appointment_id = v.id), v.minutes
             FROM visits v WHERE v.status = 'done' AND v.items = 0
           UNION ALL
           SELECT v.staff_id, false, v.service_id, NULL, coalesce(sv.price_min, 0), v.minutes
             FROM visits v LEFT JOIN services sv ON sv.id = v.service_id
            WHERE v.status <> 'done'
         )
         SELECT l.staff_id, l.done, l.service_id,
                coalesce(sv.name, max(l.name), '${OFF_LIST}') AS name,
                sv.category,
                count(*)::int AS count, sum(l.amount)::float AS amount, sum(l.minutes)::float AS minutes
           FROM lines l LEFT JOIN services sv ON sv.id = l.service_id
          GROUP BY l.staff_id, l.done, l.service_id, sv.name, sv.category`,
        p,
      );
      return rows.map((r) => ({
        staffId: r.staff_id as number,
        done: r.done as boolean,
        serviceId: (r.service_id as number | null) ?? null,
        name: r.name as string,
        category: (r.category as string | null) ?? null,
        count: r.count as number,
        amount: money(r.amount),
        minutes: minutes(r.minutes),
      }));
    },
  );

  // --- Powracalność klientów ------------------------------------------------------------------
  // Per staff member, for done visits in the range (Versum's definitions):
  // - served: distinct patients they saw;
  // - new: of those, patients whose first visit at the clinic ever falls in the range and was with them;
  // - returned to clinic / to them: of the new ones, how many came back later (to anyone / to them).
  app.get<{ Querystring: Range }>(
    "/api/stats/returning",
    { config: { access: "staff" }, preHandler: guards.stats, schema: rangeSchema },
    async (req, reply) => {
      const s = read(req, reply);
      if (!s) return;
      const { rows } = await db.query(
        `WITH done AS (
           SELECT id, patient_id, staff_id, site_id, starts_at FROM appointments
            WHERE status = 'done' AND patient_id IS NOT NULL
         ), first AS (
           SELECT DISTINCT ON (patient_id) patient_id, id, staff_id, site_id, starts_at
             FROM done ORDER BY patient_id, starts_at, id
         ), served AS (
           SELECT a.staff_id, count(DISTINCT a.patient_id)::int AS served
             FROM done a WHERE ${WINDOW} GROUP BY 1
         ), fresh AS (
           SELECT a.staff_id,
                  count(*)::int AS new,
                  count(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM done d WHERE d.patient_id = a.patient_id AND d.starts_at > a.starts_at))::int AS back_clinic,
                  count(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM done d WHERE d.patient_id = a.patient_id AND d.starts_at > a.starts_at
                       AND d.staff_id = a.staff_id))::int AS back_staff
             FROM first a WHERE ${WINDOW} GROUP BY 1
         )
         SELECT s.staff_id, s.served, coalesce(f.new, 0) AS new,
                coalesce(f.back_clinic, 0) AS back_clinic, coalesce(f.back_staff, 0) AS back_staff
           FROM served s LEFT JOIN fresh f ON f.staff_id = s.staff_id`,
        params(req.query, s.staffId),
      );
      return rows.map((r) => ({
        staffId: r.staff_id as number,
        served: r.served as number,
        new: r.new as number,
        backToClinic: r.back_clinic as number,
        backToStaff: r.back_staff as number,
      }));
    },
  );

  // --- Raport czasu pracy ---------------------------------------------------------------------
  // From the work schedule: hours planned per person and site, days of absence, and time spent at visits.
  app.get<{ Querystring: Range }>(
    "/api/stats/worktime",
    { config: { access: "staff" }, preHandler: guards.stats, schema: rangeSchema },
    async (req, reply) => {
      const s = read(req, reply);
      if (!s) return;
      const p = params(req.query, s.staffId);
      const [work, visits] = await Promise.all([
        db.query(
          `SELECT a.staff_id,
                  sum(extract(epoch FROM a.ends_at - a.starts_at) / 60) FILTER (WHERE a.kind = 'work')::float AS work_minutes,
                  count(DISTINCT (a.starts_at AT TIME ZONE '${TZ}')::date) FILTER (WHERE a.kind = 'work')::int AS work_days,
                  count(DISTINCT (a.starts_at AT TIME ZONE '${TZ}')::date) FILTER (WHERE a.kind = 'absence')::int AS absence_days
             FROM schedules a WHERE ${WINDOW} GROUP BY 1`,
          p,
        ),
        db.query(
          `SELECT a.staff_id, sum(extract(epoch FROM a.ends_at - a.starts_at) / 60)::float AS minutes
             FROM appointments a WHERE a.status = 'done' AND a.patient_id IS NOT NULL AND ${WINDOW} GROUP BY 1`,
          p,
        ),
      ]);
      const byStaff = new Map<number, { staffId: number; workMinutes: number; workDays: number; absenceDays: number; visitMinutes: number }>();
      const row = (id: number) => {
        if (!byStaff.has(id)) byStaff.set(id, { staffId: id, workMinutes: 0, workDays: 0, absenceDays: 0, visitMinutes: 0 });
        return byStaff.get(id)!;
      };
      for (const r of work.rows) {
        Object.assign(row(r.staff_id), {
          workMinutes: minutes(r.work_minutes),
          workDays: r.work_days,
          absenceDays: r.absence_days,
        });
      }
      for (const r of visits.rows) row(r.staff_id).visitMinutes = minutes(r.minutes);
      return [...byStaff.values()];
    },
  );

  // --- Stan kasy ------------------------------------------------------------------------------
  // Balance of one clinic's register: the last counted balance (opening or closing it), plus cash taken
  // at visits and money put in, minus money taken out, since then. Admins only.
  app.get<{ Querystring: Range }>(
    "/api/cash",
    { config: { access: "staff" }, preHandler: guards.admin, schema: rangeSchema },
    async (req, reply) => {
      if (!checkRange(req.query, reply)) return;
      const { site, from, to } = req.query;
      if (site === ALL_SITES) return reply.code(400).send({ error: "Kasa jest osobna dla każdej placówki: wybierz placówkę." });
      const cashAt = `coalesce(ap.paid_at, a.starts_at)`;
      const last = (
        await db.query(
          `SELECT kind, amount::float AS amount, at, u.name AS user_name
             FROM cash_operations c LEFT JOIN users u ON u.id = c.user_id
            WHERE site_id = $1 AND kind IN ('open', 'close') ORDER BY at DESC, c.id DESC LIMIT 1`,
          [site],
        )
      ).rows[0];
      const since = last?.at ?? new Date(0);
      const moves = (
        await db.query(
          `SELECT
             (SELECT coalesce(sum(ap.amount), 0) FROM appointment_payments ap JOIN appointments a ON a.id = ap.appointment_id
               WHERE a.site_id = $1 AND a.status = 'done' AND ap.method = 'cash' AND ${cashAt} > $2)::float AS cash,
             (SELECT coalesce(sum(amount), 0) FROM cash_operations WHERE site_id = $1 AND kind = 'in' AND at > $2)::float AS put_in,
             (SELECT coalesce(sum(amount), 0) FROM cash_operations WHERE site_id = $1 AND kind = 'out' AND at > $2)::float AS taken_out`,
          [site, since],
        )
      ).rows[0];
      const inRange = `>= ($2::date)::timestamp AT TIME ZONE '${TZ}' AND %s < ($3::date + 1)::timestamp AT TIME ZONE '${TZ}'`;
      const [visitCash, manual] = await Promise.all([
        db.query(
          `SELECT ap.id, ${cashAt} AS at, ap.amount::float AS amount, a.id AS appointment_id,
                  p.first_name || ' ' || p.last_name AS patient_name, st.name AS staff_name,
                  coalesce((SELECT string_agg(x.name, ', ' ORDER BY x.position) FROM appointment_services x WHERE x.appointment_id = a.id),
                           sv.name, '${OFF_LIST}') AS what
             FROM appointment_payments ap JOIN appointments a ON a.id = ap.appointment_id
             LEFT JOIN patients p ON p.id = a.patient_id
             LEFT JOIN staff st ON st.id = a.staff_id
             LEFT JOIN services sv ON sv.id = a.service_id
            WHERE a.site_id = $1 AND a.status = 'done' AND ap.method = 'cash'
              AND ${cashAt} ${inRange.replace("%s", cashAt)}
            ORDER BY 2 DESC`,
          [site, from, to],
        ),
        db.query(
          `SELECT c.id, c.kind, c.amount::float AS amount, c.note, c.at, u.name AS user_name
             FROM cash_operations c LEFT JOIN users u ON u.id = c.user_id
            WHERE c.site_id = $1 AND c.at ${inRange.replace("%s", "c.at")}
            ORDER BY c.at DESC`,
          [site, from, to],
        ),
      ]);
      return {
        balance: money((last?.amount ?? 0) + moves.cash + moves.put_in - moves.taken_out),
        open: last ? last.kind === "open" : false,
        counted: last
          ? { kind: last.kind, amount: money(last.amount), at: (last.at as Date).toISOString(), userName: last.user_name ?? null }
          : null,
        visits: visitCash.rows.map((r) => ({
          id: r.id as number,
          at: (r.at as Date).toISOString(),
          amount: money(r.amount),
          appointmentId: r.appointment_id as number,
          patientName: (r.patient_name as string | null) ?? null,
          staffName: (r.staff_name as string | null) ?? null,
          what: r.what as string,
        })),
        operations: manual.rows.map((r) => ({
          id: r.id as number,
          kind: r.kind as "in" | "out" | "open" | "close",
          amount: money(r.amount),
          note: (r.note as string | null) ?? null,
          at: (r.at as Date).toISOString(),
          userName: (r.user_name as string | null) ?? null,
        })),
      };
    },
  );

  app.post<{ Body: { siteId: string; kind: "in" | "out" | "open" | "close"; amount: number; note?: string | null } }>(
    "/api/cash",
    { config: { access: "staff", audited: true },
      preHandler: guards.admin,
      schema: {
        body: {
          type: "object",
          required: ["siteId", "kind", "amount"],
          properties: {
            siteId: { type: "string" },
            kind: { enum: ["in", "out", "open", "close"] },
            amount: { type: "number", minimum: 0, maximum: 10_000_000 },
            note: { type: ["string", "null"], maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      const { rows } = await db.query<{ id: number }>(
        "INSERT INTO cash_operations (site_id, kind, amount, note, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [b.siteId, b.kind, money(b.amount), b.note?.trim() || null, req.user!.id],
      );
      await audit(db, req.user!.id, `cash.${b.kind}`, "cash_operation", rows[0].id, { siteId: b.siteId, amount: money(b.amount) });
      return reply.code(201).send({ id: rows[0].id });
    },
  );

  // --- Closing a visit ------------------------------------------------------------------------
  // Reception picks the services done (from the price list; the price can be changed) and how the
  // patient paid. Closing again replaces both. The visit becomes "done".
  app.get<{ Params: { id: number } }>(
    "/api/appointments/:id/checkout",
    { config: { access: "staff" }, preHandler: guards.desk, schema: { params: { type: "object", properties: { id: { type: "integer" } } } } },
    async (req, reply) => {
      const visit = (await db.query("SELECT id FROM appointments WHERE id = $1", [req.params.id])).rows[0];
      if (!visit) return reply.code(404).send({ error: "Nie ma takiej wizyty." });
      const [items, paid] = await Promise.all([
        db.query(
          "SELECT service_id, name, price::float AS price FROM appointment_services WHERE appointment_id = $1 ORDER BY position, id",
          [req.params.id],
        ),
        db.query("SELECT method FROM appointment_payments WHERE appointment_id = $1 ORDER BY id LIMIT 1", [req.params.id]),
      ]);
      return {
        items: items.rows.map((r) => ({ serviceId: r.service_id as number | null, name: r.name as string, price: money(r.price) })),
        method: (paid.rows[0]?.method as string | undefined) ?? null,
      };
    },
  );

  app.put<{ Params: { id: number }; Body: { items: { serviceId: number; price: number }[]; method: PaymentMethod } }>(
    "/api/appointments/:id/checkout",
    { config: { access: "staff", audited: true },
      preHandler: guards.desk,
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
        body: {
          type: "object",
          required: ["items", "method"],
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 30,
              items: {
                type: "object",
                required: ["serviceId", "price"],
                properties: { serviceId: { type: "integer" }, price: { type: "number", minimum: 0, maximum: 1_000_000 } },
              },
            },
            method: { enum: Object.keys(PAYMENT_METHODS) },
          },
        },
      },
    },
    async (req, reply) => {
      const { items, method } = req.body;
      const ids = [...new Set(items.map((i) => i.serviceId))];
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const visit = (await client.query("SELECT id, patient_id, status FROM appointments WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
        if (!visit) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Nie ma takiej wizyty." });
        }
        if (!visit.patient_id) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "To nie jest wizyta pacjenta." });
        }
        if (["cancelled", "deleted"].includes(visit.status)) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Wizyta jest odwołana." });
        }
        const names = new Map(
          (await client.query("SELECT id, name FROM services WHERE id = ANY($1)", [ids])).rows.map((r) => [r.id as number, r.name as string]),
        );
        if (names.size !== ids.length) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Nieznana usługa." });
        }
        await client.query("DELETE FROM appointment_services WHERE appointment_id = $1", [req.params.id]);
        await client.query("DELETE FROM appointment_payments WHERE appointment_id = $1 AND source = 'desk'", [req.params.id]);
        let total = 0;
        for (const [i, item] of items.entries()) {
          const price = money(item.price);
          total += price;
          await client.query(
            "INSERT INTO appointment_services (appointment_id, service_id, name, price, position) VALUES ($1, $2, $3, $4, $5)",
            [req.params.id, item.serviceId, names.get(item.serviceId), price, i],
          );
        }
        total = money(total);
        await client.query(
          `INSERT INTO appointment_payments (appointment_id, method, method_label, amount, source, paid_at, user_id)
           VALUES ($1, $2, $3, $4, 'desk', now(), $5)`,
          [req.params.id, method, PAYMENT_METHODS[method], total, req.user!.id],
        );
        // The first service becomes the visit's service, so the calendar shows what was done.
        await client.query("UPDATE appointments SET status = 'done', service_id = $2, updated_at = now() WHERE id = $1", [
          req.params.id,
          items[0].serviceId,
        ]);
        await audit(client, req.user!.id, "appointment.checkout", "appointment", req.params.id, {
          services: items.map((i) => i.serviceId),
          method,
          total,
        });
        await client.query("COMMIT");
        return { ok: true, total };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  );
}

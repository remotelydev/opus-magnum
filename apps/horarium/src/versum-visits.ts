// Import of the visit history exported from Versum (scripts/versum/export-browser.js) into Horarium.
//
// One Versum visit → one appointment, matched again on re-runs through import_refs
// ('versum', 'appointment', <Versum event id>), so the import can be repeated before the switch-over and
// updates instead of duplicating. The raw Versum record goes to import_raw, so nothing is lost.
//
// Mapping (agreed with the clinic):
// - Staff: Versum has one entry per person and clinic ("Paweł Trumpus Turek", "Paweł Trumpus
//   Poddębice"). The clinic suffix is cut off: one Horarium staff member, the clinic goes on each visit.
//   "Higieny" becomes one calendar. An entry without a clinic suffix is reported and its visits skipped.
// - Status: removed in Versum → "deleted" (history only); tag "odwołano" → "cancelled"; finalised →
//   "done"; tag "pacjent potwierdzony" → "confirmed"; otherwise "booked". Other tags are kept as tags.
// - "Opis" → treatment_notes, as it is (it also holds some reception notes; the clinic chose to keep it
//   whole). On entries without a patient (blocks such as "grafik") it goes to notes instead.
// - Payments → appointment_payments (admins only).
import type pg from "pg";
import type { Db } from "./db.js";

export const SOURCE = "versum";

const SITE_SUFFIXES: [RegExp, string][] = [
  [/\s+Turek$/i, "turek"],
  [/\s+Podd[eę]bice$/i, "poddebice"],
];

/** "Paweł  Trumpus Turek" → { name: "Paweł Trumpus", siteId: "turek" }; null when no clinic suffix. */
export function splitStaffName(raw: string): { name: string; siteId: string } | null {
  const clean = raw.replace(/\s+/g, " ").trim();
  for (const [re, siteId] of SITE_SUFFIXES) if (re.test(clean)) return { name: clean.replace(re, "").trim(), siteId };
  return null;
}

/** A Versum visit as the export stores it: the calendar entries, or the full JSON, or both. */
export interface ExportedVisit {
  id: string;
  patient_id?: string | null;
  calendar?: CalendarPart[];
  screen?: { events?: ScreenEvent[]; missing?: boolean };
  history_row?: { cls: string; status: string | null; staff: { id: string; name: string | null }[] };
  versions?: string | null;
}
interface CalendarPart {
  event_id: number;
  start: string;
  end: string;
  customer_id: number | null;
  customer?: { id: number; full_name: string } | null;
  entities?: { id: number; type: string }[];
  events_services?: { full_name: string; employee_ids: number[] }[];
  finalized: boolean;
  canceled: boolean;
  deleted_at: string | null;
  description: string | null;
  info_from_customer?: string | null;
  tags?: (string | { name: string })[];
  payments?: { payment_method: string; payment_method_name?: string; price: number }[];
  created_at?: string;
  updated_at?: string;
}
interface ScreenEvent {
  id: number;
  customer_id: number | null;
  beginning: string;
  end: string;
  finalized: boolean;
  canceled: boolean;
  deleted_at: string | null;
  description: string | null;
  info_from_customer?: string | null;
  tags?: (string | { name: string })[];
  services: { name: string; employees: { id: number; name: string }[] }[];
  payments?: { payment_method: string; price: number }[];
  created_at?: string;
  updated_at?: string;
}

export interface Visit {
  versumId: string;
  patientVersumId: string | null;
  staff: { versumId: string; name: string | null }[];
  startsAt: string;
  endsAt: string;
  status: "booked" | "confirmed" | "cancelled" | "done" | "deleted";
  tags: string[];
  description: string | null;
  infoFromCustomer: string | null;
  services: string[];
  payments: { method: string; methodLabel: string | null; amount: number }[];
}

const PAYMENT_LABELS: Record<string, string> = { cash: "gotówka", transfer: "przelew", card: "karta" };
const tagName = (t: string | { name: string }) => (typeof t === "string" ? t : t.name).trim();
const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s : null);

/** Turn one exported record into a visit, or null when it carries no usable data. */
export function normalizeVisit(rec: ExportedVisit, staffNames: Map<string, string>): Visit | null {
  const cal = rec.calendar?.[0];
  const scr = rec.screen?.events?.[0];
  if (!cal && !scr) return null;
  // Prefer the full JSON when there is one; the calendar entry carries the same fields otherwise.
  const tags = (scr?.tags ?? cal?.tags ?? []).map(tagName).filter(Boolean);
  const deleted = !!(scr?.deleted_at ?? cal?.deleted_at) || /\bdeleted\b/.test(rec.history_row?.cls ?? "");
  const finalized = scr?.finalized ?? cal!.finalized;
  const canceled = scr?.canceled ?? cal!.canceled;
  const lower = tags.map((t) => t.toLowerCase());
  const status: Visit["status"] = deleted
    ? "deleted"
    : canceled || lower.includes("odwołano")
      ? "cancelled"
      : finalized
        ? "done"
        : lower.includes("pacjent potwierdzony")
          ? "confirmed"
          : "booked";
  const keptTags = tags.filter((t) => !["odwołano", "pacjent potwierdzony"].includes(t.toLowerCase()));

  let staff: Visit["staff"];
  let services: string[];
  if (scr) {
    staff = scr.services.flatMap((s) => s.employees.map((e) => ({ versumId: String(e.id), name: e.name })));
    services = scr.services.map((s) => s.name);
  } else {
    const parts = rec.calendar!;
    const ids = [...new Set(parts.flatMap((p) => p.events_services?.flatMap((s) => s.employee_ids) ?? p.entities?.map((e) => e.id) ?? []))];
    staff = ids.map((id) => ({ versumId: String(id), name: staffNames.get(String(id)) ?? null }));
    services = [...new Set(parts.flatMap((p) => p.events_services?.map((s) => s.full_name) ?? []))];
  }
  staff = staff.filter((s, i) => staff.findIndex((x) => x.versumId === s.versumId) === i);

  const starts = scr?.beginning ?? rec.calendar!.map((p) => p.start).sort()[0];
  const ends = scr?.end ?? rec.calendar!.map((p) => p.end).sort().at(-1)!;
  const payments = (scr?.payments ?? cal?.payments ?? []).map((p: { payment_method: string; payment_method_name?: string; price: number }) => ({
    method: p.payment_method,
    methodLabel: p.payment_method_name || PAYMENT_LABELS[p.payment_method] || null,
    amount: Number(p.price) || 0,
  }));
  const customer = scr?.customer_id ?? cal?.customer_id ?? null;

  return {
    versumId: String(rec.id),
    patientVersumId: customer ? String(customer) : rec.patient_id ?? null,
    staff,
    startsAt: starts,
    endsAt: ends,
    status,
    tags: keptTags,
    description: blankToNull(scr?.description ?? cal?.description),
    infoFromCustomer: blankToNull(scr?.info_from_customer ?? cal?.info_from_customer),
    services,
    payments,
  };
}

export interface ImportReport {
  read: number;
  inserted: number;
  updated: number;
  skipped: Record<string, number>;
  /** Staff entries without a clinic suffix, with their visit counts. */
  staffWithoutSite: Record<string, number>;
  staffCreated: string[];
  /** Visits with more than one staff member; the first one is used. */
  multiStaff: number;
  /** Visits that clash with another visit of the same person (not imported), as Versum ids. */
  overlaps: string[];
  missingPatients: number;
}

/** Find or create the Horarium staff member for a Versum staff entry. Cached per run. */
async function staffFor(
  db: pg.PoolClient,
  cache: Map<string, number>,
  report: ImportReport,
  versumId: string,
  siteId: string,
  name: string,
): Promise<number> {
  const key = versumId;
  if (cache.has(key)) return cache.get(key)!;
  const ref = await db.query("SELECT entity_id FROM import_refs WHERE source = $1 AND entity = 'staff' AND source_id = $2", [SOURCE, versumId]);
  let id: number | undefined = ref.rows[0]?.entity_id;
  if (!id) {
    const kind = /^higien/i.test(name) ? "calendar" : "person";
    const display = kind === "calendar" ? "Higieny" : name;
    const found = await db.query("SELECT id FROM staff WHERE lower(regexp_replace(name, '\\s+', ' ', 'g')) = lower($1) ORDER BY id LIMIT 1", [display]);
    id = found.rows[0]?.id;
    if (!id) {
      id = (
        await db.query(
          "INSERT INTO staff (name, kind, active, sort_order) VALUES ($1, $2, true, (SELECT coalesce(max(sort_order), 0) + 1 FROM staff)) RETURNING id",
          [display, kind],
        )
      ).rows[0].id;
      report.staffCreated.push(display);
    }
    await db.query(
      "INSERT INTO import_refs (source, entity, source_id, entity_id) VALUES ($1, 'staff', $2, $3) ON CONFLICT (source, entity, source_id) DO UPDATE SET entity_id = $3",
      [SOURCE, versumId, id],
    );
  }
  await db.query("INSERT INTO staff_sites (staff_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, siteId]);
  cache.set(key, id!);
  return id!;
}

export async function importVisits(
  pool: Db,
  records: AsyncIterable<ExportedVisit> | Iterable<ExportedVisit>,
  staffList: { id: number | string; name: string }[],
  opts: { onProgress?: (r: ImportReport) => void } = {},
): Promise<ImportReport> {
  const report: ImportReport = {
    read: 0,
    inserted: 0,
    updated: 0,
    skipped: {},
    staffWithoutSite: {},
    staffCreated: [],
    multiStaff: 0,
    overlaps: [],
    missingPatients: 0,
  };
  const skip = (why: string) => (report.skipped[why] = (report.skipped[why] ?? 0) + 1);
  const staffNames = new Map(staffList.map((s) => [String(s.id), s.name]));
  const staffCache = new Map<string, number>();
  const services = new Map<string, number>(
    (await pool.query("SELECT id, lower(name) AS name FROM services")).rows.map((r) => [r.name, r.id]),
  );

  const client = await pool.connect();
  try {
    for await (const rec of records) {
      report.read++;
      if (report.read % 1000 === 0) opts.onProgress?.(report);
      const v = normalizeVisit(rec, staffNames);
      if (!v) {
        skip("brak danych wizyty");
        continue;
      }
      if (!v.staff.length) {
        skip("brak pracownika");
        continue;
      }
      if (v.staff.length > 1) report.multiStaff++;
      const first = v.staff[0];
      const rawName = first.name ?? staffNames.get(first.versumId) ?? "";
      const split = splitStaffName(rawName);
      if (!split) {
        const label = rawName || `id ${first.versumId}`;
        report.staffWithoutSite[label] = (report.staffWithoutSite[label] ?? 0) + 1;
        skip("pracownik bez kliniki w nazwie");
        continue;
      }

      await client.query("BEGIN");
      try {
        let patientId: number | null = null;
        if (v.patientVersumId) {
          const p = await client.query("SELECT entity_id FROM import_refs WHERE source = $1 AND entity = 'patient' AND source_id = $2", [
            SOURCE,
            v.patientVersumId,
          ]);
          patientId = p.rows[0]?.entity_id ?? null;
          if (!patientId) {
            report.missingPatients++;
            skip("pacjent jeszcze nie zaimportowany");
            await client.query("ROLLBACK");
            continue;
          }
        }
        const staffId = await staffFor(client, staffCache, report, first.versumId, split.siteId, split.name);
        const serviceName = v.services[0] ?? null;
        const serviceId = serviceName ? (services.get(serviceName.toLowerCase()) ?? null) : null;
        const title = serviceId ? null : v.services.join(", ") || null;
        const treatment = patientId ? v.description : null;
        const notes = [patientId ? null : v.description, v.infoFromCustomer ? `Od pacjenta: ${v.infoFromCustomer}` : null]
          .filter(Boolean)
          .join("\n") || null;
        const endsAt = new Date(v.endsAt) > new Date(v.startsAt) ? v.endsAt : new Date(new Date(v.startsAt).getTime() + 15 * 60000).toISOString();

        const ref = await client.query("SELECT entity_id FROM import_refs WHERE source = $1 AND entity = 'appointment' AND source_id = $2", [
          SOURCE,
          v.versumId,
        ]);
        let appointmentId: number = ref.rows[0]?.entity_id;
        const values = [split.siteId, staffId, patientId, serviceId, title, v.startsAt, endsAt, v.status, notes, treatment, v.tags];
        await client.query("SAVEPOINT row");
        try {
          if (appointmentId) {
            await client.query(
              `UPDATE appointments SET site_id = $2, staff_id = $3, patient_id = $4, service_id = $5, title = $6, starts_at = $7,
                      ends_at = $8, status = $9, notes = $10, treatment_notes = $11, tags = $12, updated_at = now()
                WHERE id = $1`,
              [appointmentId, ...values],
            );
            report.updated++;
          } else {
            appointmentId = (
              await client.query(
                `INSERT INTO appointments (site_id, staff_id, patient_id, service_id, title, starts_at, ends_at, status, notes,
                                           treatment_notes, tags, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'import') RETURNING id`,
                values,
              )
            ).rows[0].id;
            await client.query("INSERT INTO import_refs (source, entity, source_id, entity_id) VALUES ($1, 'appointment', $2, $3)", [
              SOURCE,
              v.versumId,
              appointmentId,
            ]);
            report.inserted++;
          }
        } catch (error) {
          if ((error as { code?: string }).code !== "23P01") throw error;
          await client.query("ROLLBACK TO SAVEPOINT row");
          report.overlaps.push(v.versumId);
          skip("koliduje z inną wizytą tej osoby");
          await client.query(
            `INSERT INTO import_raw (source, entity, source_id, data) VALUES ($1, 'appointment', $2, $3)
             ON CONFLICT (source, entity, source_id) DO UPDATE SET data = $3, imported_at = now()`,
            [SOURCE, v.versumId, JSON.stringify(rec)],
          );
          await client.query("COMMIT");
          continue;
        }
        await client.query("DELETE FROM appointment_payments WHERE appointment_id = $1 AND source = 'import'", [appointmentId]);
        for (const p of v.payments) {
          await client.query(
            "INSERT INTO appointment_payments (appointment_id, method, method_label, amount, source) VALUES ($1, $2, $3, $4, 'import')",
            [appointmentId, p.method, p.methodLabel, p.amount],
          );
        }
        await client.query(
          `INSERT INTO import_raw (source, entity, source_id, data) VALUES ($1, 'appointment', $2, $3)
           ON CONFLICT (source, entity, source_id) DO UPDATE SET data = $3, imported_at = now()`,
          [SOURCE, v.versumId, JSON.stringify(rec)],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Versum visit ${v.versumId}: ${(error as Error).message}`);
      }
    }
    await client.query("INSERT INTO audit_log (user_id, action, entity, entity_id, changes) VALUES (NULL, 'import.versum_visits', 'import', 'versum', $1)", [
      JSON.stringify({ read: report.read, inserted: report.inserted, updated: report.updated, skipped: report.skipped }),
    ]);
  } finally {
    client.release();
  }
  return report;
}

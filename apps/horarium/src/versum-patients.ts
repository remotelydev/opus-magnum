// Versum patient import: turns one record of the NDJSON file written by
// scripts/versum/extract-patients.js into Horarium patient columns, and writes it to the database.
// Every patient is linked in import_refs ('versum', 'patient', <Versum customer id>), so a second run
// updates the same rows and the visit-history import can find the patient by its Versum id.
import { audit, type Queryable } from "./db.js";
import { normalizePhone } from "./phone.js";

export interface VersumPatientRecord {
  id: string;
  missing?: boolean;
  fields?: Record<string, string | boolean | string[]>;
  labels?: Record<string, string | string[]>;
  agreements?: Record<string, "notice" | boolean>;
  shown?: Record<string, string>;
  fetchedAt?: string;
}

/** Versum's consent "Wyrażam zgodę ... w celu przesyłania informacji handlowych" (e-mail and phone). */
export const VERSUM_MARKETING_AGREEMENT = "37520";

/** Versum's health checkboxes, by form field, with the label shown on the card. */
export const VERSUM_MEDICAL_FLAGS: Record<string, string> = {
  pregnancy: "Ciąża",
  heart_disease: "Choroby serca",
  hypertension: "Nadciśnienie",
  thyroid_disease: "Choroby tarczycy",
  diabetes: "Cukrzyca",
  epilepsy: "Epilepsja",
  jaundice: "Żółtaczka",
  anesthesia: "Podawano znieczulenie",
};

export interface MappedPatient {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  medical_flags: string[];
  description: string | null;
  sms_consent: boolean;
  email_consent: boolean;
  marketing_consent: boolean;
  gender: "female" | "male" | null;
  pesel: string | null;
  card_number: string | null;
  tax_id: string | null;
  street: string | null;
  house_number: string | null;
  unit_number: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  name_day: string | null;
  patient_groups: string[];
  origin: string | null;
  /** Clinic-local "YYYY-MM-DD HH:MM", converted in SQL. */
  created_at: string | null;
  updated_at: string | null;
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};
/** Like text(), but keeps line breaks (the description is Markdown). */
const longText = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\r\n?/g, "\n").trim();
  return s === "" ? null : s;
};
const pad = (n: number) => String(n).padStart(2, "0");

/** "16.10.2019 00:00" (clinic time, as Versum shows it) -> "2019-10-16 00:00". */
export function versumDateTime(v: string | undefined): string | null {
  const m = v?.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return `${m[3]}-${pad(+m[2])}-${pad(+m[1])} ${pad(+(m[4] ?? 0))}:${m[5] ?? "00"}`;
}

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The phone as Versum stores it: "mobile" is already international (+48…); fall back to the bare number. */
function versumPhone(f: Record<string, unknown>): { raw: string | null; phone: string | null } {
  const raw = text(f.mobile) ?? text(f.phone_number);
  return { raw, phone: raw ? normalizePhone(raw) : null };
}

export function mapVersumPatient(rec: VersumPatientRecord): MappedPatient {
  const f = rec.fields ?? {};
  const labels = rec.labels ?? {};
  const shown = rec.shown ?? {};

  const first = text(f.firstname) ?? "";
  let last = text(f.lastname) ?? "";
  if (!first && !last) last = "(brak nazwiska)";

  const year = Number(f.birth_date_year);
  const month = Number(f.birth_date_month);
  const day = Number(f.birth_date_day);
  const birth = year && month && day && validDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;

  const ndMonth = Number(f.name_day_month);
  const ndDay = Number(f.name_day_day);
  const nameDay = ndMonth && ndDay && validDate(2000, ndMonth, ndDay) ? `${pad(ndMonth)}-${pad(ndDay)}` : null;

  const flags = Object.entries(VERSUM_MEDICAL_FLAGS)
    .filter(([key]) => f[key] === true)
    .map(([, label]) => label);
  const allergies = text(f.allergies);
  if (allergies) flags.push(`Alergie: ${allergies}`);
  const other = text(f.other_disease);
  if (other) flags.push(`Inne choroby: ${other}`);

  const groups = labels["customer_group_ids[]"];

  return {
    first_name: first,
    last_name: last,
    phone: versumPhone(f).phone,
    email: text(f.email)?.toLowerCase() ?? null,
    birth_date: birth,
    medical_flags: flags,
    description: longText(f.description),
    sms_consent: f.send_reminder_sms === true,
    email_consent: f.send_reminder_email === true,
    marketing_consent: rec.agreements?.[VERSUM_MARKETING_AGREEMENT] === true,
    gender: f.gender === "female" || f.gender === "male" ? f.gender : null,
    pesel: text(f.pesel)?.replace(/\s/g, "") ?? null,
    card_number: text(f.card),
    tax_id: text(f.tax_id),
    street: text(f.street_name),
    house_number: text(f.house_number),
    unit_number: text(f.unit_number),
    postal_code: text(f.zip_code),
    city: text(f.city),
    province: text(labels.province_id),
    country: text(f.country_iso2)?.toUpperCase() ?? null,
    name_day: nameDay,
    patient_groups: Array.isArray(groups) ? groups.map((g) => g.trim()).filter(Boolean) : [],
    origin: text(labels.customer_origin_id),
    created_at: versumDateTime(shown["Data dodania"]),
    updated_at: versumDateTime(shown["Ostatnia modyfikacja"]),
  };
}

const COLUMNS = [
  "first_name", "last_name", "phone", "email", "birth_date", "medical_flags", "description",
  "sms_consent", "email_consent", "marketing_consent", "gender", "pesel", "card_number", "tax_id",
  "street", "house_number", "unit_number", "postal_code", "city", "province", "country", "name_day",
  "patient_groups", "origin",
] as const;

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  referrals: number;
  problems: { id: string; problem: string }[];
}

/**
 * Write the records. Re-running updates the patients imported earlier (Versum stays the source until
 * the switch), so run the final import before reception starts editing cards in Horarium.
 */
export async function importVersumPatients(
  db: Queryable,
  records: Iterable<VersumPatientRecord> | AsyncIterable<VersumPatientRecord>,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, referrals: 0, problems: [] };
  const referrals: [string, string][] = [];
  const n = COLUMNS.length;
  const createdAt = `coalesce(($${n + 2})::timestamp AT TIME ZONE 'Europe/Warsaw', now())`;
  const updatedAt = `coalesce(($${n + 3})::timestamp AT TIME ZONE 'Europe/Warsaw', now())`;

  for await (const rec of records) {
    if (!rec?.id || rec.missing || !rec.fields) {
      result.skipped++;
      continue;
    }
    const id = String(rec.id);
    const p = mapVersumPatient(rec);
    const { raw, phone } = versumPhone(rec.fields);
    if (raw && !phone) result.problems.push({ id, problem: "telefon nie do odczytania, zostaje tylko w import_data" });

    const values = [...COLUMNS.map((c) => p[c]), JSON.stringify(rec), p.created_at, p.updated_at];
    const ref = await db.query<{ entity_id: number }>(
      "SELECT entity_id FROM import_refs WHERE source = 'versum' AND entity = 'patient' AND source_id = $1",
      [id],
    );
    let patientId: number;
    if (ref.rows[0]) {
      patientId = ref.rows[0].entity_id;
      await db.query(
        `UPDATE patients SET ${COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(", ")},
                import_data = $${n + 1}, created_at = ${createdAt}, updated_at = ${updatedAt}
          WHERE id = $${n + 4}`,
        [...values, patientId],
      );
      result.updated++;
    } else {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO patients (${COLUMNS.join(", ")}, import_data, created_at, updated_at)
         VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(", ")}, $${n + 1}, ${createdAt}, ${updatedAt})
         RETURNING id`,
        values,
      );
      patientId = rows[0].id;
      await db.query(
        "INSERT INTO import_refs (source, entity, source_id, entity_id) VALUES ('versum', 'patient', $1, $2)",
        [id, patientId],
      );
      result.created++;
    }
    await audit(db, null, "patient.import", "patient", patientId, { source: "versum", sourceId: id });
    const referrer = text(rec.fields.recommendation_customer_id);
    if (referrer) referrals.push([id, referrer]);
  }

  // "Osoba polecająca" points at another Versum patient, so link it once everyone is in.
  for (const [patient, referrer] of referrals) {
    const { rowCount } = await db.query(
      `UPDATE patients SET referred_by_patient_id = r.entity_id
         FROM import_refs p, import_refs r
        WHERE p.source = 'versum' AND p.entity = 'patient' AND p.source_id = $1
          AND r.source = 'versum' AND r.entity = 'patient' AND r.source_id = $2
          AND patients.id = p.entity_id AND r.entity_id <> p.entity_id`,
      [patient, referrer],
    );
    if (rowCount) result.referrals++;
    else result.problems.push({ id: patient, problem: `osoba polecająca ${referrer} nie znaleziona` });
  }
  return result;
}

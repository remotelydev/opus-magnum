// Versum card extras import: dental diagram entries (versum-dodatki-….ndjson from
// scripts/versum/extract-extras.js) and the photos and files of the cards (versum-zalaczniki-….zip from
// scripts/versum/extract-assets.js). Rows are linked in import_refs ('versum', 'dental_entry' |
// 'attachment', <Versum id>), so a second run updates instead of duplicating. Patients are found by
// their Versum id, so the patient import must run first.
import { audit, type Queryable } from "./db.js";
import { versumDateTime } from "./versum-patients.js";

/** One line of versum-dodatki-….ndjson (only patients that have something). */
export interface VersumExtrasRecord {
  id: string;
  dental?: VersumDentalEntry[] | null;
  gallery?: string | null;
  files?: string | null;
}

/** An entry of Versum's dental history, as its JSON endpoint returns it. */
export interface VersumDentalEntry {
  id: number;
  tooth: number;
  surface?: string | null;
  diagnosis_name?: string | null;
  treatment_name?: string | null;
  employee_name?: string | null;
  description?: string | null;
  color?: string | null;
  created_at: string;
  [key: string]: unknown;
}

/** One entry of manifest.json in the attachments ZIP. */
export interface VersumAssetMeta {
  patientId: string;
  assetId: string;
  kind: "photo" | "file";
  name: string;
  type?: string;
  size?: number;
  createdAt?: string | null; // "17.04.2023 13:33", clinic time
  description?: string | null;
  path: string;
}

export interface ExtrasResult {
  dental: { created: number; updated: number };
  attachments: { created: number; updated: number };
  problems: { id: string; problem: string }[];
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Files of a ZIP written without compression (what extract-assets.js writes), by path. */
export function readStoredZip(buf: Buffer): Map<string, Buffer> {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a ZIP file");
  const count = buf.readUInt16LE(end + 10);
  let pos = buf.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error("broken ZIP directory");
    const method = buf.readUInt16LE(pos + 10);
    const size = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    if (method !== 0) throw new Error(`${name}: compressed entries are not supported`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    files.set(name, buf.subarray(start, start + size));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function patientIdFor(db: Queryable, versumId: string, cache: Map<string, number | null>): Promise<number | null> {
  if (!cache.has(versumId)) {
    const { rows } = await db.query<{ entity_id: number }>(
      "SELECT entity_id FROM import_refs WHERE source = 'versum' AND entity = 'patient' AND source_id = $1",
      [versumId],
    );
    cache.set(versumId, rows[0]?.entity_id ?? null);
  }
  return cache.get(versumId)!;
}

async function refFor(db: Queryable, entity: string, sourceId: string): Promise<number | null> {
  const { rows } = await db.query<{ entity_id: number }>(
    "SELECT entity_id FROM import_refs WHERE source = 'versum' AND entity = $1 AND source_id = $2",
    [entity, sourceId],
  );
  return rows[0]?.entity_id ?? null;
}

async function link(db: Queryable, entity: string, sourceId: string, id: number) {
  await db.query("INSERT INTO import_refs (source, entity, source_id, entity_id) VALUES ('versum', $1, $2, $3)", [
    entity,
    sourceId,
    id,
  ]);
}

export async function importVersumExtras(
  db: Queryable,
  records: Iterable<VersumExtrasRecord> | AsyncIterable<VersumExtrasRecord>,
  assets: Iterable<{ meta: VersumAssetMeta; data: Buffer }> = [],
): Promise<ExtrasResult> {
  const result: ExtrasResult = { dental: { created: 0, updated: 0 }, attachments: { created: 0, updated: 0 }, problems: [] };
  const patients = new Map<string, number | null>();

  for await (const rec of records) {
    if (!rec?.id || !Array.isArray(rec.dental) || !rec.dental.length) continue;
    const patientId = await patientIdFor(db, String(rec.id), patients);
    if (!patientId) {
      result.problems.push({ id: String(rec.id), problem: "pacjent nie zaimportowany, diagram pominięty" });
      continue;
    }
    for (const e of rec.dental) {
      const tooth = Number(e.tooth);
      const recorded = new Date(e.created_at);
      if (!Number.isInteger(tooth) || Number.isNaN(recorded.getTime())) {
        result.problems.push({ id: String(rec.id), problem: `wpis diagramu ${e.id} nie do odczytania` });
        continue;
      }
      const values = [
        patientId, tooth, text(e.surface), text(e.diagnosis_name), text(e.treatment_name), text(e.employee_name),
        text(e.description), text(e.color), recorded.toISOString(), JSON.stringify(e),
      ];
      const existing = await refFor(db, "dental_entry", String(e.id));
      if (existing) {
        await db.query(
          `UPDATE patient_dental_entries SET patient_id = $1, tooth = $2, surface = $3, diagnosis = $4, treatment = $5,
                  doctor_name = $6, description = $7, color = $8, recorded_at = $9, import_data = $10 WHERE id = $11`,
          [...values, existing],
        );
        result.dental.updated++;
      } else {
        const { rows } = await db.query<{ id: number }>(
          `INSERT INTO patient_dental_entries
             (patient_id, tooth, surface, diagnosis, treatment, doctor_name, description, color, recorded_at, import_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          values,
        );
        await link(db, "dental_entry", String(e.id), rows[0].id);
        result.dental.created++;
      }
    }
    await audit(db, null, "patient.import_dental", "patient", patientId, { source: "versum", entries: rec.dental.length });
  }

  for (const { meta, data } of assets) {
    const patientId = await patientIdFor(db, String(meta.patientId), patients);
    if (!patientId) {
      result.problems.push({ id: String(meta.patientId), problem: `pacjent nie zaimportowany, plik ${meta.assetId} pominięty` });
      continue;
    }
    const added = versumDateTime(meta.createdAt ?? undefined);
    const values = [
      patientId, meta.kind === "photo" ? "photo" : "file", text(meta.name) ?? `plik-${meta.assetId}`,
      text(meta.type) ?? "application/octet-stream", data.length, data, text(meta.description), added,
    ];
    const existing = await refFor(db, "attachment", String(meta.assetId));
    if (existing) {
      await db.query(
        `UPDATE patient_attachments SET patient_id = $1, kind = $2, name = $3, content_type = $4, size = $5, data = $6,
                description = $7, added_at = coalesce(($8)::timestamp AT TIME ZONE 'Europe/Warsaw', added_at) WHERE id = $9`,
        [...values, existing],
      );
      result.attachments.updated++;
    } else {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO patient_attachments (patient_id, kind, name, content_type, size, data, description, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce(($8)::timestamp AT TIME ZONE 'Europe/Warsaw', now())) RETURNING id`,
        values,
      );
      await link(db, "attachment", String(meta.assetId), rows[0].id);
      result.attachments.created++;
    }
    await audit(db, null, "patient.import_attachment", "patient", patientId, { source: "versum", assetId: meta.assetId });
  }
  return result;
}

/** Pair the ZIP's manifest with its files. */
export function assetsFromZip(files: Map<string, Buffer>): { meta: VersumAssetMeta; data: Buffer }[] {
  const manifest = files.get("manifest.json");
  if (!manifest) throw new Error("manifest.json missing from the ZIP");
  return (JSON.parse(manifest.toString("utf8")) as VersumAssetMeta[]).map((meta) => {
    const data = files.get(meta.path);
    if (!data) throw new Error(`${meta.path} listed in manifest.json but missing from the ZIP`);
    return { meta, data };
  });
}

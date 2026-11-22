// Import the Versum visit history saved by scripts/versum/export-browser.js.
//
//   pnpm --filter horarium import:versum-visits <folder with versum-visits-*.ndjson and -meta.json>
//
// Patients must be imported first (their Versum ids in import_refs); visits of patients not found yet
// are skipped and counted, and a later run picks them up. Safe to run again: it updates, never duplicates.
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createPool, migrate } from "../src/db.js";
import { importVisits, type ExportedVisit } from "../src/versum-visits.js";

const dir = process.argv[2];
if (!dir) {
  console.error("Podaj folder z plikami versum-visits-*.");
  process.exit(1);
}

const files = (await readdir(dir)).sort();
const metaFile = files.filter((f) => /^versum-visits-.*-meta\.json$/.test(f)).at(-1);
const eventFiles = files.filter((f) => /^versum-visits-.*-events-\d+\.ndjson$/.test(f));
if (!metaFile || !eventFiles.length) {
  console.error("Brak plików versum-visits-*-meta.json lub versum-visits-*-events-NNN.ndjson w tym folderze.");
  process.exit(1);
}
// Only the newest export (files share its date stamp).
const stamp = metaFile.replace(/-meta\.json$/, "");
const current = eventFiles.filter((f) => f.startsWith(`${stamp}-events-`));
const meta = JSON.parse(await readFile(join(dir, metaFile), "utf8")) as { employees: { id: number; name: string }[] };

async function* records(): AsyncGenerator<ExportedVisit> {
  for (const f of current) {
    const rl = createInterface({ input: createReadStream(join(dir, f), "utf8"), crlfDelay: Infinity });
    for await (const line of rl) if (line.trim()) yield JSON.parse(line) as ExportedVisit;
  }
}

const db = createPool();
await migrate(db);
const report = await importVisits(db, records(), meta.employees, {
  onProgress: (r) => console.log(`… ${r.read} przeczytanych, ${r.inserted} nowych, ${r.updated} zaktualizowanych`),
});
await db.end();

console.log(JSON.stringify({ ...report, overlaps: report.overlaps.length, overlapIds: report.overlaps.slice(0, 50) }, null, 2));

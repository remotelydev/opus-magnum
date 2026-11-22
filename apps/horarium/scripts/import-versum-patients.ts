// Import patients from the Versum export (NDJSON from scripts/versum/extract-patients.js).
//
//   pnpm --filter horarium import:versum-patients /path/to/versum-pacjenci-2026-11-22.ndjson
//
// Runs in one transaction: either every patient goes in or none does. Safe to run again (updates the
// patients from the earlier run). Prints counts only, never patient data.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createPool } from "../src/db.js";
import { importVersumPatients, type VersumPatientRecord } from "../src/versum-patients.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: import-versum-patients <versum-pacjenci-….ndjson>");
  process.exit(2);
}

async function* records(path: string): AsyncGenerator<VersumPatientRecord> {
  let line = 0;
  for await (const text of createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity })) {
    line++;
    if (!text.trim()) continue;
    try {
      yield JSON.parse(text);
    } catch {
      throw new Error(`line ${line} is not valid JSON`);
    }
    if (line % 1000 === 0) console.log(`  ${line} …`);
  }
}

const pool = createPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await importVersumPatients(client, records(file));
  await client.query("COMMIT");
  console.log(
    `created ${result.created}, updated ${result.updated}, skipped ${result.skipped}, referrals linked ${result.referrals}`,
  );
  if (result.problems.length) {
    console.log(`${result.problems.length} to check (Versum id: problem):`);
    for (const p of result.problems.slice(0, 50)) console.log(`  ${p.id}: ${p.problem}`);
    if (result.problems.length > 50) console.log(`  … and ${result.problems.length - 50} more`);
  }
} catch (error) {
  await client.query("ROLLBACK");
  console.error(`import failed, nothing was saved: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

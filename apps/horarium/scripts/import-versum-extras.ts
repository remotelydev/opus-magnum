// Import the dental diagram entries and the card photos and files from Versum. Run after the patient
// import (patients are found by their Versum id).
//
//   pnpm --filter horarium import:versum-extras /path/to/versum-dodatki-….ndjson /path/to/versum-zalaczniki-….zip
//
// The ZIP is optional. Runs in one transaction; safe to run again. Prints counts only, never patient data.
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createPool } from "../src/db.js";
import { assetsFromZip, importVersumExtras, readStoredZip, type VersumExtrasRecord } from "../src/versum-extras.js";

const [extrasFile, zipFile] = process.argv.slice(2);
if (!extrasFile) {
  console.error("usage: import-versum-extras <versum-dodatki-….ndjson> [versum-zalaczniki-….zip]");
  process.exit(2);
}

async function* records(path: string): AsyncGenerator<VersumExtrasRecord> {
  let line = 0;
  for await (const text of createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity })) {
    line++;
    if (!text.trim()) continue;
    try {
      yield JSON.parse(text);
    } catch {
      throw new Error(`line ${line} is not valid JSON`);
    }
  }
}

const assets = zipFile ? assetsFromZip(readStoredZip(await readFile(zipFile))) : [];
const pool = createPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await importVersumExtras(client, records(extrasFile), assets);
  await client.query("COMMIT");
  console.log(
    `dental entries: created ${result.dental.created}, updated ${result.dental.updated}; ` +
      `photos and files: created ${result.attachments.created}, updated ${result.attachments.updated}`,
  );
  if (result.problems.length) {
    console.log(`${result.problems.length} to check (Versum id: problem):`);
    for (const p of result.problems.slice(0, 50)) console.log(`  ${p.id}: ${p.problem}`);
  }
} catch (error) {
  await client.query("ROLLBACK");
  console.error(`import failed, nothing was saved: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

// Test helper: a clean database per test file. Needs TEST_DATABASE_URL (CI runs a Postgres service).
import { createPool, migrate, type Db } from "./db.js";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export async function freshDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL);
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db);
  return db;
}

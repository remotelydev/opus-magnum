import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const MIGRATION_LOCK = 727001;

export type Db = pg.Pool;
export type Queryable = Pick<pg.Pool, "query">;

export function createPool(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  return new pg.Pool({ connectionString: url });
}

/** Apply migrations/NNN_*.sql in order, each once, inside a transaction. */
export async function migrate(db: Db): Promise<string[]> {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(error as Error).message}`);
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}

/** Every write goes through here so the clinic keeps a change log (who, what, when). */
export async function audit(
  db: Queryable,
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number,
  changes?: unknown,
): Promise<void> {
  await db.query(
    "INSERT INTO audit_log (user_id, action, entity, entity_id, changes) VALUES ($1, $2, $3, $4, $5)",
    [userId, action, entity, String(entityId), changes === undefined ? null : JSON.stringify(changes)],
  );
}

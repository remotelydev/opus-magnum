import { createPool, migrate } from "../src/db.js";

const db = createPool();
try {
  const applied = await migrate(db);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
} finally {
  await db.end();
}

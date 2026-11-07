import { buildApp } from "./app.js";
import { createPool, migrate } from "./db.js";

const db = createPool();
const applied = await migrate(db);
const app = buildApp(db, { logger: true });
if (applied.length) app.log.info({ applied }, "migrations applied");

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8790);
await app.listen({ host, port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}

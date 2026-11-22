import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { createPool, migrate } from "./db.js";
import { createTg200Sender, tg200FromEnv } from "./sms.js";

const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));

const db = createPool();
const tg200 = tg200FromEnv();
const applied = await migrate(db);
const app = buildApp(db, {
  logger: true,
  webRoot: existsSync(WEB_DIST) ? WEB_DIST : undefined,
  sendSms: tg200 ? createTg200Sender(tg200) : undefined,
  // e.g. PUBLIC_ORIGINS=https://dentaplus.pl,https://www.dentaplus.pl
  publicOrigins: (process.env.PUBLIC_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
});
if (applied.length) app.log.info({ applied }, "migrations applied");
app.log.info(tg200 ? { sms: tg200.host, span: tg200.span, testList: tg200.onlyTo?.length ?? 0 } : { sms: "off" }, "sms gateway");

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

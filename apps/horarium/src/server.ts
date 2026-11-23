import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import type { Db } from "./db.js";
import { createTg200Sender, tg200FromEnv } from "./sms.js";

/** The production composition: index.ts listens on it, and the boot test builds the same thing. */
export function createServer(db: Db, env: NodeJS.ProcessEnv, webDist: string): FastifyInstance {
  const tg200 = tg200FromEnv(env);
  const app = buildApp(db, {
    logger: true,
    webRoot: existsSync(webDist) ? webDist : undefined,
    sendSms: tg200 ? createTg200Sender(tg200) : undefined,
    publicOrigins: (env.PUBLIC_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
  });
  app.log.info(tg200 ? { sms: tg200.host, span: tg200.span, testList: tg200.onlyTo?.length ?? 0 } : { sms: "off" }, "sms gateway");
  return app;
}

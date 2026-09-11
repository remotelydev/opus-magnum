import Fastify from "fastify";
import { loadConfig } from "./config.js";

const config = loadConfig();

const host = process.env.HOST ?? config.server.host;
const port = Number(process.env.PORT ?? config.server.port);

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return { ok: true, service: "reception-api" };
});

app.get("/config", async () => {
  return config;
});

await app.listen({ host, port });

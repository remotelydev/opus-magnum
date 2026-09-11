import Fastify from "fastify";
import { findLocation, loadConfig } from "./config.js";

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

app.get<{ Params: { id: string } }>("/config/:id", async (request, reply) => {
  const location = findLocation(config, request.params.id);
  if (!location) {
    return reply.code(404).send({
      error: "unknown_location",
      id: request.params.id,
    });
  }
  return location;
});

await app.listen({ host, port });

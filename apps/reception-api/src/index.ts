import Fastify from "fastify";
import { findLocation, loadConfig } from "./config.js";
import { getCachedPricelist } from "./prismic.js";

const config = loadConfig();

const host = process.env.HOST ?? config.server.host;
const port = Number(process.env.PORT ?? config.server.port);

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return { ok: true, service: "reception-api" };
});

async function loadPricelist() {
  return getCachedPricelist({
    api: config.prismic.api,
    cennikUid: config.prismic.cennikUid,
    lang: config.prismic.lang,
  });
}

app.get("/config", async (_request, reply) => {
  try {
    const pricelist = await loadPricelist();
    return { ...config, pricelist };
  } catch (error) {
    requestLog(error);
    return reply.code(200).send({
      ...config,
      pricelist: null,
      pricelistError: "prismic_unavailable",
    });
  }
});

app.get("/pricelist", async (_request, reply) => {
  try {
    return await loadPricelist();
  } catch (error) {
    requestLog(error);
    return reply.code(502).send({ error: "prismic_unavailable" });
  }
});

app.get<{ Params: { id: string } }>("/config/:id", async (request, reply) => {
  const location = findLocation(config, request.params.id);
  if (!location) {
    return reply.code(404).send({
      error: "unknown_location",
      id: request.params.id,
    });
  }
  try {
    const pricelist = await loadPricelist();
    return { ...location, pricelist };
  } catch (error) {
    requestLog(error);
    return reply.code(200).send({
      ...location,
      pricelist: null,
      pricelistError: "prismic_unavailable",
    });
  }
});

function requestLog(error: unknown) {
  app.log.error(error);
}

await app.listen({ host, port });

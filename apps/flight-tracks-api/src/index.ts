import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { createFlights } from "./generator/flights.js";

const config = loadConfig();

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return { ok: true, service: "flight-tracks-api" };
});

app.get("/meta", async () => {
  const flights = createFlights(config.generator);
  return {
    service: "flight-tracks-api",
    protocol: "TRK1",
    server: config.server,
    generator: config.generator,
    chaos: config.chaos,
    flightCountGenerated: flights.length,
    sampleFlight: flights[0],
  };
});

await app.listen({
  host: config.server.host,
  port: config.server.port,
});

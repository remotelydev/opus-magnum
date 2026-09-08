import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { createFlights } from "./generator/flights.js";
import { samplesAlongRoute } from "./generator/samples.js";

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
    samples: samplesAlongRoute(flights[0].waypoints, 0, 1000, 8000, 30),
  };
});

await app.listen({
  host: config.server.host,
  port: config.server.port,
});

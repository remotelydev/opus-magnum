import Fastify from "fastify";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8788);

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return { ok: true, service: "reception-api" };
});

await app.listen({ host, port });

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const host = process.env.HOST ?? config.server.host;
const port = Number(process.env.PORT ?? config.server.port);

const app = await buildApp();
await app.listen({ host, port });

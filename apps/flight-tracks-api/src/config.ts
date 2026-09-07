import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

export interface ServerConfig {
  host: string;
  port: number;
}

export interface GeneratorConfig {
  seed: number;
  flightCount: number;
  windowPastSec: number;
  windowFutureSec: number;
}

export interface ChaosConfig {
  delayMs: number;
  jitterMs: number;
  errorRate: number;
  errorStatus: number;
  slowBody: boolean;
  slowBodyChunkBytes: number;
  slowBodyChunkDelayMs: number;
  truncate: boolean;
  truncateKeepRatio: number;
  corrupt: boolean;
}

export interface AppConfig {
  server: ServerConfig;
  generator: GeneratorConfig;
  chaos: ChaosConfig;
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadConfig(): AppConfig {
  const path = process.env.CONFIG_PATH
    ? process.env.CONFIG_PATH
    : join(root, "config/default.json");
  return loadJson(path) as AppConfig;
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface DayHours {
  open: string;
  close: string;
}

export interface ClinicConfig {
  name: string;
  address: string;
  parking: string;
  services: string[];
}

export interface ServerConfig {
  host: string;
  port: number;
}

export interface AppConfig {
  server: ServerConfig;
  timezone: string;
  ringCount: number;
  clinic: ClinicConfig;
  hours: {
    monday: DayHours | null;
    tuesday: DayHours | null;
    wednesday: DayHours | null;
    thursday: DayHours | null;
    friday: DayHours | null;
    saturday: DayHours | null;
    sunday: DayHours | null;
  };
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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface DayHours {
  open: string;
  close: string;
}

export type WeekHours = {
  monday: DayHours | null;
  tuesday: DayHours | null;
  wednesday: DayHours | null;
  thursday: DayHours | null;
  friday: DayHours | null;
  saturday: DayHours | null;
  sunday: DayHours | null;
};

export interface LocationConfig {
  id: string;
  name: string;
  address: string;
  parking: string;
  phone: string;
  email: string;
  hours: WeekHours;
  services: string[];
}

export interface ServerConfig {
  host: string;
  port: number;
}

export interface PrismicConfig {
  api: string;
  cennikUid: string;
  lang: string;
}

export interface AppConfig {
  server: ServerConfig;
  brand: string;
  timezone: string;
  ringCount: number;
  prismic: PrismicConfig;
  locations: LocationConfig[];
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

export function findLocation(
  config: AppConfig,
  id: string,
): LocationConfig | undefined {
  return config.locations.find((location) => location.id === id);
}

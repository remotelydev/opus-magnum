import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadLocalEnv(
  path = join(dirname(fileURLToPath(import.meta.url)), "../.env"),
): void {
  if (!existsSync(path)) {
    return;
  }
  // Variables set outside .env win; inside .env the last line wins, like `. ./.env`.
  const preset = new Set(Object.keys(process.env));
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!preset.has(key)) {
      process.env[key] = value;
    }
  }
}

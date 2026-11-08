// Generates src/tokens/tokens.css from src/tokens/tokens.ts.
//   pnpm --filter @opus-magnum/dentaplus-ui tokens          write the file
//   pnpm --filter @opus-magnum/dentaplus-ui tokens --check  exit 1 if it is stale
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/tokens/render.ts";

const out = fileURLToPath(new URL("../src/tokens/tokens.css", import.meta.url));
const css = renderTokensCss();

if (process.argv.includes("--check")) {
  const current = readFileSync(out, "utf8");
  if (current !== css) {
    console.error("tokens.css is stale: run `pnpm --filter @opus-magnum/dentaplus-ui tokens`");
    process.exit(1);
  }
  console.log("tokens.css is up to date");
} else {
  writeFileSync(out, css);
  console.log(`wrote ${out}`);
}

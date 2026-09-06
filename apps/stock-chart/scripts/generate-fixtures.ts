import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { fetchFinnhubCandles } from "../lib/finnhub";
import type { CandleSeries } from "../lib/types";

loadEnv({ path: path.resolve(process.cwd(), "../../.env.local") });
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

const SYMBOLS = ["AAPL", "MSFT", "NVDA"] as const;
const FIXTURE_DIR = path.join(process.cwd(), "data", "fixtures");

async function main() {
  if (!process.env.FINNHUB_API_KEY?.trim()) {
    console.error(
      "FINNHUB_API_KEY is required. Copy .env.example to .env.local and set your free key from https://finnhub.io/register",
    );
    process.exit(1);
  }

  await mkdir(FIXTURE_DIR, { recursive: true });

  for (const symbol of SYMBOLS) {
    const series = await fetchFinnhubCandles(symbol);
    const fixture: CandleSeries = {
      ...series,
      source: "fixture",
    };
    const outPath = path.join(FIXTURE_DIR, `${symbol}.json`);
    await writeFile(outPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    console.log(`Wrote ${outPath} (${fixture.candles.length} candles)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

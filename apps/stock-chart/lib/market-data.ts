import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchFinnhubCandles, hasFinnhubApiKey } from "./finnhub";
import type { CandleSeries } from "./types";

const FIXTURE_DIR = path.join(process.cwd(), "data", "fixtures");

async function loadFixture(symbol: string): Promise<CandleSeries | null> {
  const filePath = path.join(FIXTURE_DIR, `${symbol.toUpperCase()}.json`);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as CandleSeries;
    return {
      ...parsed,
      symbol: symbol.toUpperCase(),
      source: "fixture",
    };
  } catch {
    return null;
  }
}

export type MarketDataResult = {
  series: CandleSeries | null;
  error?: string;
};

export async function resolveMarketData(symbol: string): Promise<MarketDataResult> {
  const ticker = symbol.toUpperCase();

  if (hasFinnhubApiKey()) {
    try {
      const series = await fetchFinnhubCandles(ticker);
      return { series };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Finnhub error";
      const fixture = await loadFixture(ticker);
      if (fixture) {
        return { series: fixture, error: `Live data failed (${message}); using fixture.` };
      }
      return { series: null, error: message };
    }
  }

  const fixture = await loadFixture(ticker);
  if (fixture) {
    return { series: fixture };
  }

  return {
    series: null,
    error: `No FINNHUB_API_KEY and no fixture for ${ticker}.`,
  };
}

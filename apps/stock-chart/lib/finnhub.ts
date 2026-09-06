import type { Candle, CandleSeries, FinnhubCandleResponse } from "./types";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const DEFAULT_LOOKBACK_DAYS = 180;
export const REVALIDATE_SECONDS = 60 * 15;

function getApiKey(): string | undefined {
  const key = process.env.FINNHUB_API_KEY?.trim();
  return key || undefined;
}

export function hasFinnhubApiKey(): boolean {
  return Boolean(getApiKey());
}

export function toCandleSeries(
  symbol: string,
  response: FinnhubCandleResponse,
  source: CandleSeries["source"],
): CandleSeries {
  if (response.s !== "ok" || !response.t?.length) {
    throw new Error(`Finnhub returned no candle data for ${symbol}`);
  }

  const { t, o, h, l, c, v } = response;
  if (!o || !h || !l || !c || !v) {
    throw new Error(`Finnhub candle payload incomplete for ${symbol}`);
  }

  const candles: Candle[] = t.map((time, index) => ({
    time,
    open: o[index]!,
    high: h[index]!,
    low: l[index]!,
    close: c[index]!,
    volume: v[index]!,
  }));

  return {
    symbol: symbol.toUpperCase(),
    resolution: "D",
    source,
    generatedAt: new Date().toISOString(),
    candles,
  };
}

export async function fetchFinnhubCandles(
  symbol: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CandleSeries> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("FINNHUB_API_KEY is not set");
  }

  const ticker = symbol.toUpperCase();
  const to = Math.floor(Date.now() / 1000);
  const from = to - lookbackDays * 24 * 60 * 60;
  const url = new URL(`${FINNHUB_BASE}/stock/candle`);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("resolution", "D");
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  url.searchParams.set("token", apiKey);

  const response = await fetch(url.toString(), {
    ...(process.env.NEXT_RUNTIME
      ? { next: { revalidate: REVALIDATE_SECONDS } }
      : { cache: "no-store" }),
  });

  if (!response.ok) {
    throw new Error(
      `Finnhub request failed for ${ticker}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as FinnhubCandleResponse;
  return toCandleSeries(ticker, payload, "finnhub");
}

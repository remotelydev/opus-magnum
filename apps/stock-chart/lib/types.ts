export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CandleSeries = {
  symbol: string;
  resolution: "D";
  source: "finnhub" | "fixture";
  generatedAt: string;
  candles: Candle[];
};

export type FinnhubCandleResponse = {
  c?: number[];
  h?: number[];
  l?: number[];
  o?: number[];
  v?: number[];
  t?: number[];
  s: "ok" | "no_data";
};

import type { Metadata } from "next";
import { StockChart } from "@/components/StockChart";
import { TickerForm } from "@/components/TickerForm";
import { resolveMarketData } from "@/lib/market-data";

export const revalidate = 900;

type TickerPageProps = {
  params: Promise<{ ticker: string }>;
};

export async function generateMetadata({
  params,
}: TickerPageProps): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  return {
    title: symbol,
    description: `Minimal ${symbol} chart showcase (Finnhub + fixtures).`,
  };
}

export default async function TickerPage({ params }: TickerPageProps) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  const { series, error } = await resolveMarketData(symbol);

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-[#0b0f14] px-4 py-4 text-zinc-100 sm:px-6">
      <header className="w-full">
        <TickerForm initialTicker={symbol} />
      </header>

      <section className="min-h-0 flex-1 rounded border border-zinc-800 bg-[#0b0f14]">
        {series ? (
          <StockChart candles={series.candles} />
        ) : (
          <div className="flex h-[420px] items-center justify-center px-6 text-center text-zinc-400">
            No candle data for {symbol}. Try AAPL, MSFT, or NVDA fixtures, or set
            FINNHUB_API_KEY for live data.
          </div>
        )}
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import { Card, CardContent } from "@opus-magnum/ui/components/card";
import { Separator } from "@opus-magnum/ui/components/separator";
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
  const { series } = await resolveMarketData(symbol);

  return (
    <main className="flex min-h-screen flex-col gap-6 bg-background px-5 py-6 text-foreground sm:px-8">
      <header className="w-full space-y-2">
        <TickerForm initialTicker={symbol} />
        <Separator />
      </header>

      {series ? (
        <Card className="py-0">
          <CardContent className="px-0">
            <StockChart candles={series.candles} />
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="flex h-[420px] items-center justify-center px-6 text-center text-mute">
            No candle data for {symbol}. Try AAPL, MSFT, or NVDA fixtures, or
            set FINNHUB_API_KEY for live data.
          </CardContent>
        </Card>
      )}
    </main>
  );
}

"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/types";

/** Soft newspaper palette — Tailwind stone */
const ink = "#44403c"; // stone-700
const inkSoft = "#78716c"; // stone-500
const mute = "#a8a29e"; // stone-400
const rule = "#e7e5e4"; // stone-200
const ruleStrong = "#d6d3d1"; // stone-300
const upFill = "#1c1917"; // stone-900
const downFill = "#fafaf9"; // stone-50
const downStroke = "#57534e"; // stone-600

type StockChartProps = {
  candles: Candle[];
};

export function StockChart({ candles }: StockChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: inkSoft,
        fontFamily: "var(--font-newsreader), ui-serif, Georgia, serif",
        fontSize: 12,
      },
      grid: {
        vertLines: {
          color: rule,
          style: LineStyle.Dotted,
        },
        horzLines: {
          color: rule,
          style: LineStyle.Dotted,
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: mute,
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: ink,
        },
        horzLine: {
          color: mute,
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: ink,
        },
      },
      rightPriceScale: {
        borderColor: ruleStrong,
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: ruleStrong,
        ticksVisible: false,
      },
      handleScroll: {
        vertTouchDrag: false,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: upFill,
      downColor: downFill,
      borderVisible: true,
      borderUpColor: upFill,
      borderDownColor: downStroke,
      wickUpColor: upFill,
      wickDownColor: downStroke,
      priceLineVisible: true,
      priceLineColor: mute,
      priceLineStyle: LineStyle.SparseDotted,
      priceLineWidth: 1,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    series.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
    chart.timeScale().fitContent();
  }, [candles]);

  return <div ref={containerRef} className="h-full w-full min-h-[420px]" />;
}

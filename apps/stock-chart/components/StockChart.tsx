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

type StockChartProps = {
  candles: Candle[];
};

function toRgb(color: string, fallback: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallback;
  ctx.fillStyle = color;
  const serialized = ctx.fillStyle;
  if (serialized.startsWith("#") || serialized.startsWith("rgb")) {
    return serialized;
  }
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return fallback;
  if (a === 255) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function tokenColor(
  el: HTMLElement,
  token: `--${string}`,
  fallback: string,
): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  el.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") {
    return fallback;
  }
  return toRgb(color, fallback);
}

function chartPalette(el: HTMLElement) {
  return {
    ink: tokenColor(el, "--chart-4", "#44403c"),
    inkSoft: tokenColor(el, "--mute", "#78716c"),
    mute: tokenColor(el, "--chart-5", "#a8a29e"),
    rule: tokenColor(el, "--muted", "#e7e5e4"),
    ruleStrong: tokenColor(el, "--rule", "#d6d3d1"),
    upFill: tokenColor(el, "--chart-1", "#1c1917"),
    downFill: tokenColor(el, "--paper", "#fafaf9"),
    downStroke: tokenColor(el, "--chart-2", "#57534e"),
  };
}

export function StockChart({ candles }: StockChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const palette = chartPalette(container);

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: palette.inkSoft,
        fontFamily: "var(--font-sans), ui-serif, Georgia, serif",
        fontSize: 12,
      },
      grid: {
        vertLines: {
          color: palette.rule,
          style: LineStyle.Dotted,
        },
        horzLines: {
          color: palette.rule,
          style: LineStyle.Dotted,
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: palette.mute,
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: palette.ink,
        },
        horzLine: {
          color: palette.mute,
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: palette.ink,
        },
      },
      rightPriceScale: {
        borderColor: palette.ruleStrong,
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: palette.ruleStrong,
        ticksVisible: false,
      },
      handleScroll: {
        vertTouchDrag: false,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: palette.upFill,
      downColor: palette.downFill,
      borderVisible: true,
      borderUpColor: palette.upFill,
      borderDownColor: palette.downStroke,
      wickUpColor: palette.upFill,
      wickDownColor: palette.downStroke,
      priceLineVisible: true,
      priceLineColor: palette.mute,
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

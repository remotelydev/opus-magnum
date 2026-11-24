// Helpers for the statistics screen: date ranges, durations and the Excel download.
import { addDays } from "./time.ts";

export type Preset = "today" | "week" | "month" | "lastMonth" | "year" | "custom";
export const PRESET_LABEL: Record<Preset, string> = {
  today: "Dziś",
  week: "Ten tydzień",
  month: "Ten miesiąc",
  lastMonth: "Poprzedni miesiąc",
  year: "Ten rok",
  custom: "Własny zakres",
};

/** Whole clinic days of a preset, given today's clinic date "YYYY-MM-DD". Weeks start on Monday. */
export function presetRange(preset: Exclude<Preset, "custom">, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStart = (yy: number, mm: number) => `${yy}-${pad(mm)}-01`;
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
      return { from: addDays(today, -weekday), to: today };
    }
    case "month":
      return { from: monthStart(y, m), to: today };
    case "lastMonth": {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: monthStart(py, pm), to: addDays(monthStart(y, m), -1) };
    }
    case "year":
      return { from: `${y}-01-01`, to: today };
  }
}

/** 135 → "2 h 15 min", 45 → "45 min", 0 → "0 min" (as Versum writes it). */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "12,5%"; a dash when there is nothing to divide by. */
export function percent(part: number, whole: number): string {
  if (!whole) return "—";
  return `${(Math.round((part / whole) * 1000) / 10).toLocaleString("pl-PL")}%`;
}

/**
 * A table as CSV that Excel opens straight away in Polish settings: semicolons, decimal commas, UTF-8
 * with a byte-order mark so "ę" and "ł" survive.
 */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const text = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

export function downloadCsv(name: string, rows: (string | number)[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

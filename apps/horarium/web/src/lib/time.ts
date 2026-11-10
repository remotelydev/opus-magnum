import { calendar } from "@opus-magnum/dentaplus-ui/tokens";

// All calendar maths happens in the clinic's time zone, whatever the browser is set to.
export const CLINIC_TZ = "Europe/Warsaw";
export const DAY_START_MIN = calendar.dayStartMinutes;
export const DAY_END_MIN = calendar.dayEndMinutes;
export const SLOT_MIN = calendar.slotMinutes;

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLINIC_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function zonedParts(date: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** "2026-12-01" for the clinic's current day. */
export function todayInClinic(now = new Date()): string {
  return zonedParts(now).date;
}

/** Minutes since local midnight and the local date of an instant. */
export function toClinicTime(iso: string | Date): { date: string; minutes: number } {
  return zonedParts(typeof iso === "string" ? new Date(iso) : iso);
}

/** Instant for a clinic-local date and minutes since midnight (handles DST). */
export function fromClinicTime(date: string, minutes: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  // Correct by the zone offset at the guess, then once more in case we crossed a DST switch.
  let utc = guess;
  for (let i = 0; i < 2; i++) {
    const local = zonedParts(new Date(utc));
    const [ly, lm, ld] = local.date.split("-").map(Number);
    const localAsUtc = Date.UTC(ly, lm - 1, ld, 0, local.minutes);
    utc += guess - localAsUtc;
  }
  return new Date(utc);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseHhmm(text: string): number | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

const dayFmt = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatDay(date: string): string {
  return dayFmt.format(new Date(`${date}T12:00:00Z`));
}

export interface Placed<T> {
  item: T;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/**
 * Lay out one calendar column: position by time, and split overlapping items into side-by-side
 * lanes (e.g. a cancelled visit under a new one). top/height are in minutes from DAY_START_MIN.
 */
export function layoutColumn<T extends { startMin: number; endMin: number }>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const placed: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];

  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.startMin >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    const top = Math.max(item.startMin, DAY_START_MIN) - DAY_START_MIN;
    const bottom = Math.min(item.endMin, DAY_END_MIN) - DAY_START_MIN;
    const p: Placed<T> = { item, top, height: Math.max(bottom - top, SLOT_MIN), lane, lanes: 1 };
    cluster.push(p);
    placed.push(p);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return placed;
}

// The calendar's day-and-staff panel: the month grid, and which people get a column.
import type { Appointment, ScheduleBlock, Staff } from "./api.ts";
import { isoWeekday } from "./schedule.ts";
import { addDays, toClinicTime } from "./time.ts";

/** Fallback for a person saved before colours existed; the server gives new people a palette colour. */
const FALLBACK_COLORS = ["#5b9bd5", "#5fc4ad", "#3a9ea5", "#b18cd9", "#7f95e0", "#5fb88a", "#e89ab5", "#c08a3e"];

export function staffColor(s: Pick<Staff, "id" | "color">): string {
  return s.color ?? FALLBACK_COLORS[s.id % FALLBACK_COLORS.length]!;
}

// --- month grid ---------------------------------------------------------------------------------

/** "2026-11" for "2026-11-11". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + months, 1)).toISOString().slice(0, 7);
}

/** Six full weeks, Monday first, that cover the month (days of the next and previous month included). */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const start = addDays(first, 1 - isoWeekday(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

const monthFmt = new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", month: "long" });

/** "listopad 2026" (nominative, as on a wall calendar). */
export function formatMonth(month: string): string {
  return `${monthFmt.format(new Date(`${month}-15T12:00:00Z`))} ${month.slice(0, 4)}`;
}

// --- who works ----------------------------------------------------------------------------------

/**
 * People with a column worth seeing on a day: a work block in their schedule that day, or a visit
 * (anything not cancelled) booked with them, so a visit outside the schedule is never hidden.
 */
export function workingIds(
  date: string,
  schedules: Pick<ScheduleBlock, "staffId" | "startsAt" | "endsAt" | "kind">[],
  appointments: Pick<Appointment, "staffId" | "startsAt" | "status">[],
): Set<number> {
  const ids = new Set<number>();
  const next = addDays(date, 1);
  for (const b of schedules) {
    if (b.kind !== "work") continue;
    const start = toClinicTime(b.startsAt).date;
    const end = toClinicTime(b.endsAt);
    // Overlaps the day: starts before tomorrow and ends after today's midnight.
    if (start < next && (end.date > date || (end.date === date && end.minutes > 0))) ids.add(b.staffId);
  }
  for (const a of appointments) {
    if (a.status !== "cancelled" && toClinicTime(a.startsAt).date === date) ids.add(a.staffId);
  }
  return ids;
}

/** Work hours of each person on a day, e.g. "8:00–16:00" or "8:00–12:00, 13:00–18:00". */
export function workHours(date: string, schedules: Pick<ScheduleBlock, "staffId" | "startsAt" | "endsAt" | "kind">[]) {
  const ranges = new Map<number, Array<[number, number]>>();
  for (const b of schedules) {
    if (b.kind !== "work") continue;
    const s = toClinicTime(b.startsAt);
    const e = toClinicTime(b.endsAt);
    if (s.date > date || e.date < date) continue;
    const from = s.date === date ? s.minutes : 0;
    const to = e.date === date ? e.minutes : 24 * 60;
    if (to <= from) continue;
    ranges.set(b.staffId, [...(ranges.get(b.staffId) ?? []), [from, to]]);
  }
  const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return new Map(
    [...ranges].map(([id, list]) => [
      id,
      list
        .sort((a, b) => a[0] - b[0])
        .map(([a, b]) => `${hm(a)}–${hm(b)}`)
        .join(", "),
    ]),
  );
}

// --- the user's choice --------------------------------------------------------------------------

/**
 * "auto": whoever works that day (the default). "manual": the people the user ticked, kept as the
 * day changes until they go back to "by schedule".
 */
export type ColumnChoice = { mode: "auto" } | { mode: "manual"; ids: number[] };

export const AUTO: ColumnChoice = { mode: "auto" };

const choiceKey = (site: string) => `horarium.columns.${site}`;

export function parseChoice(raw: string | null | undefined): ColumnChoice {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (value?.mode === "manual" && Array.isArray(value.ids) && value.ids.every(Number.isInteger)) {
      return { mode: "manual", ids: value.ids };
    }
  } catch {
    /* damaged entry: start again from the schedule */
  }
  return AUTO;
}

export function readChoice(site: string): ColumnChoice {
  try {
    return parseChoice(localStorage.getItem(choiceKey(site)));
  } catch {
    return AUTO;
  }
}

export function saveChoice(site: string, choice: ColumnChoice): void {
  try {
    if (choice.mode === "auto") localStorage.removeItem(choiceKey(site));
    else localStorage.setItem(choiceKey(site), JSON.stringify(choice));
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

/** The ids ticked in the panel. On a day nobody is scheduled (e.g. Sunday), "auto" ticks nobody. */
export function selectedIds(staff: Pick<Staff, "id">[], choice: ColumnChoice, working: Set<number>): Set<number> {
  if (choice.mode === "manual") return new Set(choice.ids);
  return new Set(staff.filter((s) => working.has(s.id)).map((s) => s.id));
}

/** Tick or untick one person; the first change turns the day's automatic set into a manual one. */
export function toggle(current: Set<number>, id: number): ColumnChoice {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { mode: "manual", ids: [...next] };
}

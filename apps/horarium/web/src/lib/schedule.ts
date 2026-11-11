import type { PatternDay } from "./api.ts";
import { addDays } from "./time.ts";

/** ISO order: index 0 is Monday (weekday 1), index 6 is Sunday (weekday 7). */
export const WEEKDAY_NAMES = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"] as const;

/** ISO weekday of a "YYYY-MM-DD" date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the week a date falls in. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** The last day of the month `months` after the month of `date`. */
export function endOfMonthAfter(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months + 1, 0)).toISOString().slice(0, 10);
}

/** Hours per week of a pattern, e.g. 37.5. */
export function weeklyHours(days: Pick<PatternDay, "starts" | "ends">[]): number {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return days.reduce((sum, d) => sum + Math.max(0, minutes(d.ends) - minutes(d.starts)), 0) / 60;
}

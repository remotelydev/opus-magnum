// Helpers for the registration form on the clinic iPad (/rejestracja).
import type { Answer, Field, IntakeForm } from "../../../src/intake-form.ts";

/** Text sizes the patient can pick, as multiples of the tablet's base size. */
export const FONT_STEPS = [1, 1.15, 1.3, 1.5] as const;
/** Base text size on the tablet: larger than the desk UI, it is read at arm's length. */
export const BASE_FONT_PX = 18;

/** A started form is cleared after this long without a touch (asked first, see IDLE_COUNTDOWN_S). */
export const IDLE_AFTER_S = 120;
export const IDLE_COUNTDOWN_S = 30;
/** The thank-you screen goes back to the start by itself after this long. */
export const THANKS_RESET_S = 15;

export function stepFont(index: number, delta: 1 | -1): number {
  return Math.min(FONT_STEPS.length - 1, Math.max(0, index + delta));
}

/** The step holding the first field with an error, or null. */
export function firstErrorStep(form: IntakeForm, errors: Record<string, string>): number | null {
  const i = form.steps.findIndex((s) => s.fields.some((f) => errors[f.id]));
  return i < 0 ? null : i;
}

/** Joins day, month and year fields into "YYYY-MM-DD"; "" when all are empty, "?" when only some are. */
export function composeDate(day: string, month: string, year: string): string {
  if (!day && !month && !year) return "";
  if (!day || !month || !/^\d{4}$/.test(year)) return "?";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function splitDate(value: string): { day: string; month: string; year: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) } : { day: "", month: "", year: "" };
}

export const MONTHS = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

/** How an answer reads on the "check your details" screen. */
export function formatAnswer(field: Field, value: Answer | undefined): string {
  if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) return "—";
  if (field.type === "consent") return value === true ? "Tak" : "Nie";
  if (field.type === "choice" || field.type === "multi") {
    const chosen = Array.isArray(value) ? value : [value];
    return field.options.filter((o) => chosen.includes(o.value)).map((o) => o.label).join(", ");
  }
  if (field.type === "date" && typeof value === "string") {
    const { day, month, year } = splitDate(value);
    return day ? `${day} ${MONTHS[Number(month) - 1]} ${year}` : value;
  }
  if (field.type === "tel" && typeof value === "string") {
    const digits = value.replace(/\D/g, "");
    if (/^48\d{9}$/.test(digits)) return digits.slice(2).replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
  }
  return String(value);
}

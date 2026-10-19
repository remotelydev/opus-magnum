import type { LocationConfig } from "./config.js";

export const NOTE_MAX_LENGTH = 120;

export interface StaffConfirmation {
  date: string;
  time: string;
  note: string | null;
}

export type ParseResult =
  | { ok: true; confirmation: StaffConfirmation }
  | { ok: false; reason: "not_ok" | "invalid_date" | "invalid_time" | "note_too_long" };

const OK_PATTERN =
  /^\s*ok\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?\s+(\d{1,2})[:.](\d{2})(?:\s+([\s\S]*))?$/i;

function todayIn(timeZone: string, now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function isValidDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function parseStaffReply(text: string, timeZone: string, now = new Date()): ParseResult {
  const match = OK_PATTERN.exec(text);
  if (!match) {
    return { ok: false, reason: "not_ok" };
  }
  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw, noteRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const today = todayIn(timeZone, now);
  let year: number;
  if (yearRaw) {
    year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
  } else {
    year = today.year;
    const isPast = month < today.month || (month === today.month && day < today.day);
    if (isPast) {
      year += 1;
    }
  }
  if (!isValidDate(year, month, day)) {
    return { ok: false, reason: "invalid_date" };
  }
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (hour > 23 || minute > 59) {
    return { ok: false, reason: "invalid_time" };
  }
  const note = noteRaw?.replace(/\s+/g, " ").trim() || null;
  if (note && note.length > NOTE_MAX_LENGTH) {
    return { ok: false, reason: "note_too_long" };
  }
  return {
    ok: true,
    confirmation: {
      date: `${year}-${pad(month)}-${pad(day)}`,
      time: `${pad(hour)}:${pad(minute)}`,
      note,
    },
  };
}

const WEEKDAY_PL = ["nd", "pn", "wt", "śr", "czw", "pt", "sob"];

function sentence(text: string): string {
  const trimmed = text.trim();
  const capped = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

export function formatConfirmationSms(
  location: Pick<LocationConfig, "name" | "phone">,
  confirmation: StaffConfirmation,
): string {
  const [year, month, day] = confirmation.date.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAY_PL[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const parts = [
    `${location.name}: potwierdzamy wizytę ${day}.${month} (${weekday}) o ${confirmation.time}.`,
    confirmation.note ? sentence(confirmation.note) : null,
    `W razie zmiany prosimy o telefon ${location.phone}.`,
  ];
  return parts.filter((part): part is string => part !== null).join(" ");
}

const REASON_PL: Record<Exclude<ParseResult, { ok: true }>["reason"], string> = {
  not_ok: "Nie rozumiem. Odpowiedz na zgłoszenie: OK 7.10 14:30 (opcjonalnie uwagi).",
  invalid_date: "Błędna data. Przykład: OK 7.10 14:30",
  invalid_time: "Błędna godzina. Przykład: OK 7.10 14:30",
  note_too_long: `Uwagi są za długie (max ${NOTE_MAX_LENGTH} znaków).`,
};

export function parseErrorMessage(reason: Exclude<ParseResult, { ok: true }>["reason"]): string {
  return REASON_PL[reason];
}

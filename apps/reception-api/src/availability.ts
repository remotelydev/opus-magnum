import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LocationConfig, WeekHours } from "./config.js";
import { isClosedDate } from "./holidays.js";
import { spokenName } from "./script.js";

const DEFAULT_EXPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "versum-export");
const MINUTE = 60_000;
const STEP_MINUTES = 15;
export const STALE_AFTER_HOURS = 24;
const HYGIENE_HORIZON_DAYS = 56;
const UTC_WEEKDAYS: (keyof WeekHours)[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const DAY_PARTS = ["rano", "poludnie", "popoludnie"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

export const VISIT_KINDS = ["wizyta", "higienizacja"] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];

const DAY_PART_HOURS: Record<DayPart, [number, number]> = {
  rano: [0, 12],
  poludnie: [11, 15],
  popoludnie: [14, 24],
};

export interface VersumEmployee {
  id: number;
  name: string;
  site: string | null;
  hasCalendar: boolean;
}

export interface VersumSchedule {
  employeeId: number;
  date: string;
  from: string;
  to: string;
  kind: string;
}

export interface VersumBusySlot {
  employeeId: number;
  start: string;
  end: string;
}

export interface VersumCalendar {
  exportedAt: string;
  employees: VersumEmployee[];
  schedules: VersumSchedule[];
  busy: VersumBusySlot[];
}

export interface FreeSlot {
  start: string;
  label: string;
  employeeId: number;
  doctor: string;
}

export interface AvailabilityQuery {
  durationMinutes: number;
  kind?: VisitKind;
  part?: DayPart;
  fromDate?: string;
  employeeId?: number;
  limit?: number;
  leadMinutes?: number;
}

export interface AvailabilityAnswer {
  site: string;
  slots: FreeSlot[];
  exportedAt: string;
  stale: boolean;
}

function readJson(dir: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
}

export function loadVersumCalendar(dir = process.env.VERSUM_EXPORT_DIR || DEFAULT_EXPORT_DIR): VersumCalendar {
  const employees = readJson(dir, "employees.json");
  const schedules = readJson(dir, "schedules.json");
  const busy = readJson(dir, "busy-slots.json");
  return {
    exportedAt: String(busy.exportedAt ?? schedules.exportedAt ?? employees.exportedAt),
    employees: employees.employees as VersumEmployee[],
    schedules: schedules.schedules as VersumSchedule[],
    busy: busy.slots as VersumBusySlot[],
  };
}

function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function siteEmployees(
  calendar: VersumCalendar,
  location: LocationConfig,
  kind: VisitKind = "wizyta",
): VersumEmployee[] {
  if (kind === "higienizacja") {
    const hygiene = location.versumHygieneCalendarIds ?? [];
    return calendar.employees.filter((employee) => hygiene.includes(employee.id));
  }
  const allowed = location.versumEmployeeIds;
  return calendar.employees.filter((employee) => {
    if (allowed?.length) {
      return allowed.includes(employee.id);
    }
    return employee.hasCalendar && employee.site !== null && plain(employee.site) === plain(location.id);
  });
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function slotLabel(instant: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("pl-PL", { timeZone, weekday: "long" }).format(instant);
  const { date, hour, minute } = zonedParts(instant, timeZone);
  const [, month, day] = date.split("-");
  return `${weekday} ${day}.${month} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function zonedInstant(date: string, time: string, timeZone: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(guess))
    .find((part) => part.type === "timeZoneName")?.value;
  const match = offset?.match(/GMT([+-])(\d{2}):(\d{2})/);
  const minutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  return guess - minutes * MINUTE;
}

export function openingHourWindows(
  location: LocationConfig,
  employeeId: number,
  now: Date,
  timeZone: string,
): VersumSchedule[] {
  const today = zonedParts(now, timeZone).date;
  const windows: VersumSchedule[] = [];
  for (let offset = 0; offset < HYGIENE_HORIZON_DAYS; offset++) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) + offset * 24 * 60 * MINUTE)
      .toISOString()
      .slice(0, 10);
    const hours = location.hours[UTC_WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]];
    if (!hours) {
      continue;
    }
    windows.push({
      employeeId,
      date,
      from: new Date(zonedInstant(date, hours.open, timeZone)).toISOString(),
      to: new Date(zonedInstant(date, hours.close, timeZone)).toISOString(),
      kind: "open",
    });
  }
  return windows;
}

function inDayPart(instant: Date, durationMinutes: number, part: DayPart, timeZone: string): boolean {
  const [fromHour, toHour] = DAY_PART_HOURS[part];
  const start = zonedParts(instant, timeZone);
  const startMinutes = start.hour * 60 + start.minute;
  return startMinutes >= fromHour * 60 && startMinutes + durationMinutes <= toHour * 60;
}

export function findFreeSlots(
  calendar: VersumCalendar,
  location: LocationConfig,
  query: AvailabilityQuery,
  timeZone: string,
  now = new Date(),
): AvailabilityAnswer {
  const duration = query.durationMinutes * MINUTE;
  const earliest = now.getTime() + (query.leadMinutes ?? 120) * MINUTE;
  const limit = query.limit ?? 3;
  const closedDates = location.closedDates ?? [];
  const doctors = siteEmployees(calendar, location, query.kind).filter(
    (employee) => query.employeeId === undefined || employee.id === query.employeeId,
  );
  const doctorById = new Map(doctors.map((employee) => [employee.id, employee]));

  const busyByEmployee = new Map<number, [number, number][]>();
  for (const slot of calendar.busy) {
    if (!doctorById.has(slot.employeeId)) {
      continue;
    }
    const list = busyByEmployee.get(slot.employeeId) ?? [];
    list.push([Date.parse(slot.start), Date.parse(slot.end)]);
    busyByEmployee.set(slot.employeeId, list);
  }

  const windows = [...calendar.schedules];
  if (query.kind === "higienizacja") {
    for (const employee of doctors) {
      if (!calendar.schedules.some((item) => item.employeeId === employee.id && item.kind === "open")) {
        windows.push(...openingHourWindows(location, employee.id, now, timeZone));
      }
    }
  }

  const candidates: FreeSlot[] = [];
  for (const window of windows) {
    const doctor = doctorById.get(window.employeeId);
    if (!doctor || window.kind !== "open") {
      continue;
    }
    if (query.fromDate && window.date < query.fromDate) {
      continue;
    }
    if (isClosedDate(window.date, closedDates)) {
      continue;
    }
    const windowEnd = Date.parse(window.to);
    const busy = busyByEmployee.get(doctor.id) ?? [];
    const step = STEP_MINUTES * MINUTE;
    const windowStart = Date.parse(window.from);
    let start = windowStart;
    if (start < earliest) {
      start = windowStart + Math.ceil((earliest - windowStart) / step) * step;
    }
    for (; start + duration <= windowEnd; start += step) {
      const end = start + duration;
      if (busy.some(([busyStart, busyEnd]) => busyStart < end && start < busyEnd)) {
        continue;
      }
      const instant = new Date(start);
      if (query.part && !inDayPart(instant, query.durationMinutes, query.part, timeZone)) {
        continue;
      }
      candidates.push({
        start: instant.toISOString(),
        label: slotLabel(instant, timeZone),
        employeeId: doctor.id,
        doctor:
          query.kind === "higienizacja"
            ? "higienistka"
            : (location.versumNames?.[String(doctor.id)] ?? doctor.name),
      });
      break;
    }
  }

  candidates.sort((a, b) => a.start.localeCompare(b.start) || a.employeeId - b.employeeId);
  const stale = now.getTime() - Date.parse(calendar.exportedAt) > STALE_AFTER_HOURS * 60 * MINUTE;
  return {
    site: spokenName(location),
    slots: candidates.slice(0, limit),
    exportedAt: calendar.exportedAt,
    stale,
  };
}

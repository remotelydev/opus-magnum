// "Wszystkie" in the site switcher: both clinics on one calendar, and the three ways to tell them apart.
import type { Appointment, ScheduleBlock, Site, Staff } from "./api.ts";
import { toClinicTime } from "./time.ts";

/** The site switcher's value for both clinics at once; the API reads `site=all` the same way. */
export const ALL_SITES = "all";

/**
 * How the "Wszystkie" view tells the clinics apart, so the clinic can pick the one it likes:
 * "color": one column per person, each visit's stripe in its clinic's colour;
 * "label": one column per person, each visit names its clinic;
 * "columns": a group of columns per clinic, a person working in both appears in each.
 */
export type AllVariant = "color" | "label" | "columns";
export const ALL_VARIANTS: { id: AllVariant; label: string }[] = [
  { id: "color", label: "Kolor" },
  { id: "label", label: "Etykieta" },
  { id: "columns", label: "Kolumny" },
];

const SITE_COLORS: Record<string, string> = { turek: "#2563eb", poddebice: "#ea580c" };
const FALLBACK = ["#7c3aed", "#0d9488", "#db2777"];

export function siteColor(siteId: string): string {
  return SITE_COLORS[siteId] ?? FALLBACK[[...siteId].reduce((n, c) => n + c.charCodeAt(0), 0) % FALLBACK.length]!;
}

export function siteName(sites: Site[], siteId: string): string {
  return sites.find((s) => s.id === siteId)?.name ?? siteId;
}

/** One calendar column: a person, and the clinic it is limited to (null: every clinic). */
export interface CalendarColumn {
  key: string;
  staff: Staff;
  siteId: string | null;
}

/**
 * Columns for the calendar. One site, or "Wszystkie" shown by colour or label: one column per
 * ticked person. "Wszystkie" by columns: a group per clinic, holding the ticked people who work
 * or have a visit there that day; someone ticked with nothing on that day shows in each of their clinics.
 */
export function calendarColumns(
  sites: Pick<Site, "id">[],
  people: Staff[],
  date: string,
  schedules: Pick<ScheduleBlock, "staffId" | "siteId" | "startsAt" | "endsAt" | "kind">[],
  appointments: Pick<Appointment, "staffId" | "siteId" | "startsAt" | "status">[],
  byClinic: boolean,
): CalendarColumn[] {
  if (!byClinic) return people.map((s) => ({ key: String(s.id), staff: s, siteId: null }));
  const at = new Map<number, Set<string>>();
  const mark = (staffId: number, siteId: string) => at.set(staffId, (at.get(staffId) ?? new Set()).add(siteId));
  for (const b of schedules) {
    if (b.kind !== "work") continue;
    if (toClinicTime(b.startsAt).date <= date && toClinicTime(b.endsAt).date >= date) mark(b.staffId, b.siteId);
  }
  for (const a of appointments) {
    if (a.status !== "cancelled" && toClinicTime(a.startsAt).date === date) mark(a.staffId, a.siteId);
  }
  const out: CalendarColumn[] = [];
  for (const site of sites) {
    for (const s of people) {
      const there = at.get(s.id);
      if (there ? there.has(site.id) : s.sites.includes(site.id)) {
        out.push({ key: `${site.id}:${s.id}`, staff: s, siteId: site.id });
      }
    }
  }
  return out;
}

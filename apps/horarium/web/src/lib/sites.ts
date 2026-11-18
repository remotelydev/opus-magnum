// "Wszystkie" in the site switcher: both clinics on one calendar, each in its own colour.
import type { Site, Staff } from "./api.ts";

/** The site switcher's value for both clinics at once; the API reads `site=all` the same way. */
export const ALL_SITES = "all";

const SITE_COLORS: Record<string, string> = { turek: "#2563eb", poddebice: "#ea580c" };
const FALLBACK = ["#7c3aed", "#0d9488", "#db2777"];

export function siteColor(siteId: string): string {
  return SITE_COLORS[siteId] ?? FALLBACK[[...siteId].reduce((n, c) => n + c.charCodeAt(0), 0) % FALLBACK.length]!;
}

export function siteName(sites: Site[], siteId: string): string {
  return sites.find((s) => s.id === siteId)?.name ?? siteId;
}

/** One calendar column: a person (every clinic's visits when "Wszystkie" is on). */
export interface CalendarColumn {
  key: string;
  staff: Staff;
  siteId: string | null;
}

/** One column per ticked person. */
export function calendarColumns(people: Staff[]): CalendarColumn[] {
  return people.map((s) => ({ key: String(s.id), staff: s, siteId: null }));
}

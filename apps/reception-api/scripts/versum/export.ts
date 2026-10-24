// Read-only export of non-patient reference data from Versum into
// versum-export/. Runs inside a logged-in page (see session.ts, /export).
//
// Patient data: event payloads carry customer fields (events_services.full_name
// is the patient's name, not the service). Only times, employee ids and the
// visit/block flag are copied out. The feed has no service id, so busy slots
// carry no service.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../versum-export");
const ORIGIN = "https://panel.versum.com";
const WEEKS = 8;
const SITES = ["Turek", "Poddębice"] as const;

type VersumEmployee = { id: number; name: string; has_calendar: boolean };
type ScheduleEntry = { valid_from: string; valid_to: string; kind: string; kind_extension: string; kind_extension_name: string; allday: boolean };
type VersumEvent = {
  start: string; end: string; canceled: boolean; deleted_at: string | null; not_an_appointment: boolean;
  events_services: { started_at: string; duration: number; employee_ids: number[]; resource_ids: number[]; }[];
};

const warsawDate = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" });
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Anna Nowak Turek" -> { name: "Anna Nowak", site: "Turek" } */
function splitSite(full: string) {
  const parts = full.trim().split(/\s+/);
  const last = parts.at(-1) as (typeof SITES)[number];
  return SITES.includes(last) ? { name: parts.slice(0, -1).join(" "), site: last } : { name: full.trim(), site: null };
}

/** Let the app's GraphQL *queries* through the read-only guard; mutations stay blocked. */
async function allowGraphqlQueries(page: Page) {
  const ctx = page.context() as BrowserContext & { __gqlGuard?: true };
  if (ctx.__gqlGuard) return;
  ctx.__gqlGuard = true;
  await ctx.route("**/graphql", (route) => {
    const body = route.request().postData() ?? "";
    let ops: { query?: string }[] = [];
    try { const parsed = JSON.parse(body); ops = Array.isArray(parsed) ? parsed : [parsed]; } catch { /* not JSON: leave to guard */ }
    const readOnly = ops.length > 0 && ops.every((o) => typeof o.query === "string" && !/^\s*mutation\b/m.test(o.query) && !/\bmutation\s*[({A-Za-z]/.test(o.query));
    return readOnly ? route.continue() : route.fallback();
  });
}

async function graphql<T>(page: Page, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  await sleep(1200);
  const res = await page.evaluate(async ({ query, variables }) => {
    const csrf = document.querySelector<HTMLMetaElement>("meta[name=csrf-token]")?.content ?? "";
    const r = await fetch("/graphql", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ query, variables }),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, { query, variables });
  const json = res.json as { data?: T; errors?: { message: string }[] } | null;
  if (res.status !== 200 || !json?.data) throw new Error(`graphql ${res.status}: ${json?.errors?.map((e) => e.message).join("; ").slice(0, 200) ?? "no data"}`);
  return json.data;
}

const RESOURCES_QUERY = `query GetResources { resources { id name } }`;

/** GET the way the app's own XHRs do (Rails wants X-Requested-With and the CSRF header). */
async function get(page: Page, url: string): Promise<{ status: number; body: unknown }> {
  await sleep(1200);
  return page.evaluate(async (u) => {
    const csrf = document.querySelector<HTMLMetaElement>("meta[name=csrf-token]")?.content ?? "";
    const r = await fetch(u, { credentials: "include", headers: { accept: "*/*", "x-requested-with": "XMLHttpRequest", "x-csrf-token": csrf } });
    const text = await r.text();
    try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: null }; }
  }, url);
}

async function writeJson(name: string, data: unknown) {
  const path = join(OUT_DIR, name);
  await writeFile(`${path}.tmp`, JSON.stringify(data, null, 2) + "\n");
  await rename(`${path}.tmp`, path);
}

export async function runExport(page: Page) {
  await mkdir(OUT_DIR, { recursive: true });
  const slug = new URL(page.url()).pathname.split("/")[1];
  if (!slug || slug === "signin") throw new Error("not logged in");
  const exportedAt = new Date().toISOString();
  const missing: string[] = [];

  // Calendar page: employee list as data attribute, plus the schedules id its own request uses.
  let schedulesPath = "";
  const onRequest = (r: { url(): string }) => {
    const m = new URL(r.url()).pathname.match(/^\/settings\/timetable\/schedules\/\d+$/);
    if (m) schedulesPath = m[0];
  };
  page.on("request", onRequest);
  await sleep(1200);
  await page.goto(`${ORIGIN}/${slug}/calendar`, { waitUntil: "networkidle" });
  page.off("request", onRequest);
  const calendarEmployees = await page.evaluate(
    () => JSON.parse(document.querySelector("[data-all-employees]")?.getAttribute("data-all-employees") ?? "[]") as VersumEmployee[],
  );
  const init = (await get(page, "/todo/archives/initial_data?category=")).body as { employees?: { id: number; role: string }[] };
  const versumRole = new Map((init.employees ?? []).map((e) => [e.id, e.role]));

  const employees = calendarEmployees.map((e) => ({
    id: e.id,
    ...splitSite(e.name),
    versumRole: versumRole.get(e.id) ?? null,
    hasCalendar: e.has_calendar,
  }));
  const siteOf = new Map(employees.map((e) => [e.id, e.site]));
  const withCalendar = employees.filter((e) => e.hasCalendar).map((e) => e.id);
  missing.push("employee specialty: Versum stores none; only name, site suffix and permission role");

  // Weeks covering today .. today + 8 weeks.
  const today = warsawDate(new Date());
  const until = addDays(today, WEEKS * 7);
  const weekStarts = Array.from({ length: WEEKS + 1 }, (_, i) => addDays(today, i * 7));

  // Work schedules (grafik), one week per request.
  const schedules: unknown[] = [];
  if (!schedulesPath) missing.push("schedules: calendar did not request its schedules endpoint");
  else {
    const ids = withCalendar.map((id) => `employee_ids[]=${id}`).join("&");
    for (const date of weekStarts) {
      const r = await get(page, `${schedulesPath}?format=json&${ids}&date=${date}&period=agendaWeek`);
      if (r.status !== 200) throw new Error(`schedules ${date}: HTTP ${r.status}`);
      for (const [day, perDay] of Object.entries(r.body as Record<string, { employee?: Record<string, ScheduleEntry[]> }>)) {
        if (day < today || day >= until) continue;
        for (const [id, entries] of Object.entries(perDay.employee ?? {}))
          for (const s of entries)
            schedules.push({
              employeeId: Number(id), site: siteOf.get(Number(id)) ?? null, date: day,
              from: s.valid_from, to: s.valid_to, allDay: s.allday,
              kind: s.kind, kindExtension: s.kind_extension || null, kindName: s.kind_extension_name || null,
            });
      }
    }
  }

  // Occupied slots: the calendar's events feed, one week per request.
  const busy: unknown[] = [];
  const userIds = withCalendar.map((id) => `user_ids[]=${id}`).join("&");
  for (const start of weekStarts) {
    const end = addDays(start, 7) > until ? until : addDays(start, 7);
    if (start >= end) break;
    const r = await get(page, `/events/?format=json&r=${Math.floor(Math.random() * 1e6)}&${userIds}&start=${start}&end=${end}`);
    if (r.status !== 200) throw new Error(`events ${start}: HTTP ${r.status}`);
    for (const ev of r.body as VersumEvent[]) {
      if (ev.canceled || ev.deleted_at) continue;
      for (const es of ev.events_services ?? []) {
        const startAt = new Date(es.started_at);
        for (const employeeId of es.employee_ids) {
          busy.push({
            employeeId,
            site: siteOf.get(employeeId) ?? null,
            start: es.started_at,
            end: new Date(startAt.getTime() + es.duration * 60_000).toISOString(),
            kind: ev.not_an_appointment ? "block" : "visit",
          });
        }
      }
    }
  }

  // Services are not exported: the clinic's list lives on dentaplus.pl (Prismic cennik).

  // Site settings: branch opening hours form (read from the page, never submitted) and resources.
  await sleep(1200);
  await page.goto(`${ORIGIN}/${slug}/settings/timetable/branch`, { waitUntil: "networkidle" });
  const openingHours = await page.evaluate(() => {
    const rows: { daysMask: string | null; kind: string | null; from: string | null; to: string | null }[] = [];
    for (let i = 0; i < 14; i++) {
      const p = `default_schedule_form[schedules_attributes][${i}]`;
      const mask = document.querySelector<HTMLInputElement>(`[name="${p}[days_mask]"]`);
      if (!mask) break;
      const kinds = [...document.querySelectorAll<HTMLInputElement>(`[name="${p}[kind]"]`)];
      const kind = kinds.find((k) => (k.type === "checkbox" || k.type === "radio" ? k.checked : false)) ?? kinds.find((k) => k.type === "hidden");
      // no named helper here: tsx would wrap it in __name(), which the page doesn't have
      const [from, to] = ["valid_from_time", "valid_to_time"].map((n) => document.querySelector<HTMLSelectElement>(`[name="${p}[${n}]"]`)?.value ?? null);
      rows.push({ daysMask: mask.value, kind: kind?.value ?? null, from, to });
    }
    return rows;
  });
  let resources: { id: number; name: string }[] = [];
  await allowGraphqlQueries(page);
  try { resources = (await graphql<{ resources: { id: number; name: string }[] }>(page, RESOURCES_QUERY)).resources; }
  catch (err) { missing.push(`resources: ${(err as Error).message}`); }
  if (!resources.length) missing.push("rooms/chairs: no resources defined in Versum");
  missing.push("opening hours are one set for the whole Versum branch; Versum has no separate Turek/Poddębice sites");

  const sites = {
    versumBranches: 1,
    note: "One Versum branch covers both clinics; site comes from the employee name suffix.",
    sites: SITES.map((s) => ({ name: s, employeeCount: employees.filter((e) => e.site === s).length })),
    openingHours,
    resources,
  };

  const meta = { exportedAt, from: today, until };
  await writeJson("employees.json", { ...meta, employees });
  await writeJson("schedules.json", { ...meta, schedules });
  await writeJson("busy-slots.json", { ...meta, slots: busy });
  await writeJson("sites.json", { ...meta, ...sites });

  return {
    out: OUT_DIR,
    counts: { employees: employees.length, schedules: schedules.length, busySlots: busy.length, openingHourRows: openingHours.length, resources: resources.length },
    missing,
  };
}

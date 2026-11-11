// Fills the database with made-up demo data (no real patients) for development, screenshots and the preview.
//   DATABASE_URL=... pnpm --filter horarium seed:demo
//
// The scale follows the clinic's Versum account (counts only, read in Nov 2026): 26 935 patient cards,
// 24 people on the staff list (22 at Turek, 17 at Poddębice, 15 of them at both) plus the "Higiena"
// calendar, 35 services in 7 categories (15 to 120 min) and about 45 visits a day. Every name, phone
// number and note below is invented; nothing is copied from Versum.
//
// Runs on an empty database. A database this script filled earlier (it has the demo admin) that is still
// smaller than this scale is emptied and filled again. Any other database with patients is left alone.
import { createUser } from "../src/auth.js";
import { createPool, migrate, type Db } from "../src/db.js";
import { STAFF_PALETTE } from "../src/settings.js";

const DEMO_PASSWORD = process.env.CLINIC_PASSWORD ?? "demo-demo-demo";
const DEMO_ADMIN_NAME = "Administrator (demo)";
const TZ = "Europe/Warsaw";

const SCALE = {
  patients: 26_935,
  visitsPerWeekday: 45, // both sites together, a fully booked week
  visitsPerSaturday: 8,
  daysBack: 90,
  daysAhead: 60,
};

type Site = "turek" | "poddebice";

// Deterministic randomness: the same demo data on every run.
let seed = 20261111;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const chance = (p: number) => rand() < p;
function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// --- staff ---------------------------------------------------------------------------------------------
type Specialty = "general" | "endo" | "ortho" | "surgery" | "prosth" | "perio" | "kids" | "hygiene";
const STAFF: Array<{ name: string; title: string; sites: Site[]; specialty: Specialty; kind?: "calendar" }> = [
  // Turek only
  { name: "lek. dent. Anna Wróblewska", title: "lekarz dentysta", sites: ["turek"], specialty: "general" },
  { name: "lek. dent. Tomasz Gajewski", title: "lekarz dentysta, endodonta", sites: ["turek"], specialty: "endo" },
  { name: "lek. dent. Ewa Kalinowska", title: "lekarz dentysta, ortodonta", sites: ["turek"], specialty: "ortho" },
  { name: "lek. dent. Marcin Sobczak", title: "lekarz dentysta, chirurg", sites: ["turek"], specialty: "surgery" },
  { name: "lek. dent. Julia Pawlak", title: "lekarz dentysta", sites: ["turek"], specialty: "general" },
  { name: "hig. stom. Natalia Michalak", title: "higienistka stomatologiczna", sites: ["turek"], specialty: "hygiene" },
  { name: "lek. dent. Karol Urban", title: "lekarz dentysta, protetyk", sites: ["turek"], specialty: "prosth" },
  // Poddębice only
  { name: "lek. dent. Barbara Jasińska", title: "lekarz dentysta", sites: ["poddebice"], specialty: "general" },
  { name: "hig. stom. Weronika Szulc", title: "higienistka stomatologiczna", sites: ["poddebice"], specialty: "hygiene" },
  // Both sites
  { name: "lek. dent. Piotr Baran", title: "lekarz dentysta, endodonta", sites: ["turek", "poddebice"], specialty: "endo" },
  { name: "lek. dent. Magdalena Czarnecka", title: "lekarz dentysta", sites: ["turek", "poddebice"], specialty: "general" },
  { name: "lek. dent. Łukasz Wysocki", title: "lekarz dentysta, chirurg", sites: ["turek", "poddebice"], specialty: "surgery" },
  { name: "lek. dent. Aleksandra Sikora", title: "lekarz dentysta, ortodonta", sites: ["turek", "poddebice"], specialty: "ortho" },
  { name: "lek. dent. Rafał Kubiak", title: "lekarz dentysta", sites: ["turek", "poddebice"], specialty: "general" },
  { name: "lek. dent. Monika Laskowska", title: "lekarz dentysta, periodontolog", sites: ["turek", "poddebice"], specialty: "perio" },
  { name: "lek. dent. Grzegorz Ostrowski", title: "lekarz dentysta, protetyk", sites: ["turek", "poddebice"], specialty: "prosth" },
  { name: "lek. dent. Karolina Witkowska", title: "lekarz dentysta, stomatologia dziecięca", sites: ["turek", "poddebice"], specialty: "kids" },
  { name: "lek. dent. Adam Walczak", title: "lekarz dentysta", sites: ["turek", "poddebice"], specialty: "general" },
  { name: "lek. dent. Paulina Górecka", title: "lekarz dentysta", sites: ["turek", "poddebice"], specialty: "general" },
  { name: "lek. dent. Daniel Krajewski", title: "lekarz dentysta, implantolog", sites: ["turek", "poddebice"], specialty: "surgery" },
  { name: "hig. stom. Patrycja Kozłowska", title: "higienistka stomatologiczna", sites: ["turek", "poddebice"], specialty: "hygiene" },
  { name: "lek. dent. Izabela Mazurek", title: "lekarz dentysta", sites: ["turek", "poddebice"], specialty: "general" },
  { name: "lek. dent. Sebastian Wieczorek", title: "lekarz dentysta", sites: ["turek", "poddebice"], specialty: "general" },
  { name: "lek. dent. Oliwia Adamczyk", title: "lekarz dentysta, ortodonta", sites: ["turek", "poddebice"], specialty: "ortho" },
  // Shared chair used like a calendar, as "Higiena" is in Versum.
  { name: "Higienizacja", title: "", sites: ["turek", "poddebice"], specialty: "hygiene", kind: "calendar" },
];

const SHIFTS: Record<Site, Array<[string, string]>> = {
  turek: [["08:00", "14:00"], ["14:00", "20:00"], ["08:00", "16:00"], ["12:00", "20:00"]],
  poddebice: [["09:00", "14:00"], ["13:00", "18:00"], ["09:00", "18:00"]],
};

/** Weekly patterns: most people work 1 to 3 days a week, hygienists more; two dentists cover Saturdays in Turek. */
function workPatterns(): Array<{ staff: number; weekday: number; site: Site; starts: string; ends: string }> {
  const rows: Array<{ staff: number; weekday: number; site: Site; starts: string; ends: string }> = [];
  STAFF.forEach((s, i) => {
    if (s.kind === "calendar") {
      // One chair cannot be in two places at once: Tuesdays and Thursdays it moves to Poddębice after noon.
      for (const weekday of [1, 3, 5]) rows.push({ staff: i, weekday, site: "turek", starts: "08:00", ends: "16:00" });
      for (const weekday of [2, 4]) {
        rows.push({ staff: i, weekday, site: "turek", starts: "08:00", ends: "12:00" });
        rows.push({ staff: i, weekday, site: "poddebice", starts: "13:00", ends: "18:00" });
      }
      return;
    }
    const days = s.specialty === "hygiene" ? 4 : 1 + Math.floor(rand() * 3);
    for (const weekday of shuffle([1, 2, 3, 4, 5]).slice(0, days).sort()) {
      const site: Site = s.sites.length === 1 ? s.sites[0] : chance(0.6) ? "turek" : "poddebice";
      const [starts, ends] = pick(SHIFTS[site]);
      rows.push({ staff: i, weekday, site, starts, ends });
    }
  });
  rows.push({ staff: 0, weekday: 6, site: "turek", starts: "09:00", ends: "13:00" });
  rows.push({ staff: 10, weekday: 6, site: "turek", starts: "09:00", ends: "13:00" });
  return rows;
}

// --- services ------------------------------------------------------------------------------------------
type Category = "Diagnostyka" | "Zachowawcza" | "Endodoncja" | "Higienizacja" | "Chirurgia" | "Protetyka" | "Ortodoncja";
// [category, name, minutes, price min, price max, note]
const SERVICES: Array<[Category, string, number, number, number, string | null]> = [
  ["Diagnostyka", "Przegląd i konsultacja", 30, 150, 150, null],
  ["Diagnostyka", "Konsultacja specjalistyczna", 30, 200, 250, null],
  ["Diagnostyka", "Zdjęcie RTG punktowe", 15, 40, 40, "za zdjęcie"],
  ["Diagnostyka", "Zdjęcie pantomograficzne", 15, 120, 120, null],
  ["Diagnostyka", "Plan leczenia kompleksowego", 45, 250, 300, null],
  ["Zachowawcza", "Wypełnienie małe", 30, 250, 300, "za ząb"],
  ["Zachowawcza", "Wypełnienie średnie", 45, 300, 400, "za ząb"],
  ["Zachowawcza", "Wypełnienie duże", 60, 400, 550, "za ząb"],
  ["Zachowawcza", "Odbudowa zęba na wkładzie", 60, 450, 650, "za ząb"],
  ["Zachowawcza", "Lakowanie bruzd", 15, 100, 120, "za ząb"],
  ["Zachowawcza", "Wizyta adaptacyjna dziecka", 30, 100, 100, null],
  ["Endodoncja", "Leczenie kanałowe zęba jednokanałowego", 60, 700, 900, null],
  ["Endodoncja", "Leczenie kanałowe zęba dwukanałowego", 90, 900, 1200, null],
  ["Endodoncja", "Leczenie kanałowe zęba wielokanałowego", 120, 1200, 1800, null],
  ["Endodoncja", "Powtórne leczenie kanałowe", 120, 1400, 2000, null],
  ["Endodoncja", "Opatrunek leczniczy", 30, 150, 200, null],
  ["Higienizacja", "Skaling", 30, 200, 200, null],
  ["Higienizacja", "Piaskowanie", 30, 150, 150, null],
  ["Higienizacja", "Higienizacja pełna", 60, 300, 350, null],
  ["Higienizacja", "Fluoryzacja", 15, 80, 80, null],
  ["Higienizacja", "Wybielanie nakładkowe", 45, 900, 1200, null],
  ["Chirurgia", "Ekstrakcja zęba", 30, 250, 400, null],
  ["Chirurgia", "Ekstrakcja zęba mądrości", 60, 500, 900, null],
  ["Chirurgia", "Wszczepienie implantu", 120, 3500, 4500, null],
  ["Chirurgia", "Nacięcie ropnia", 30, 200, 250, null],
  ["Chirurgia", "Zdjęcie szwów", 15, 50, 50, null],
  ["Protetyka", "Wycisk", 30, 200, 200, null],
  ["Protetyka", "Korona pełnoceramiczna", 60, 1800, 2400, "za ząb"],
  ["Protetyka", "Proteza częściowa", 45, 1500, 2200, null],
  ["Protetyka", "Naprawa protezy", 30, 200, 350, null],
  ["Protetyka", "Licówka porcelanowa", 60, 1600, 2200, "za ząb"],
  ["Ortodoncja", "Konsultacja ortodontyczna", 30, 200, 200, null],
  ["Ortodoncja", "Założenie aparatu stałego", 120, 3000, 4000, "za łuk"],
  ["Ortodoncja", "Wizyta kontrolna z aparatem", 30, 200, 250, null],
  ["Ortodoncja", "Zdjęcie aparatu i retencja", 60, 400, 600, null],
];

const SPECIALTY_CATEGORY: Record<Specialty, Category | null> = {
  general: null,
  endo: "Endodoncja",
  ortho: "Ortodoncja",
  surgery: "Chirurgia",
  prosth: "Protetyka",
  perio: "Higienizacja",
  kids: "Zachowawcza",
  hygiene: "Higienizacja",
};
const GENERAL_MIX: Array<[Category, number]> = [
  ["Diagnostyka", 0.3],
  ["Zachowawcza", 0.5],
  ["Endodoncja", 0.1],
  ["Chirurgia", 0.05],
  ["Protetyka", 0.05],
];

/** Index into SERVICES for a visit with this person, or -1 for "usługa spoza cennika". */
function pickService(specialty: Specialty): number {
  if (specialty !== "hygiene" && chance(0.05)) return -1;
  let category = SPECIALTY_CATEGORY[specialty];
  if (specialty !== "hygiene" && (!category || chance(0.45))) {
    let r = rand();
    category = GENERAL_MIX.find(([, w]) => (r -= w) < 0)?.[0] ?? "Zachowawcza";
  }
  const options = SERVICES.flatMap((s, i) => (s[0] === category ? [i] : []));
  // The first services of a category are the everyday ones: make them more likely.
  return options[Math.floor(rand() * rand() * options.length)];
}

// --- patients ------------------------------------------------------------------------------------------
const FEMALE = ["Anna", "Maria", "Katarzyna", "Małgorzata", "Agnieszka", "Barbara", "Ewa", "Krystyna", "Elżbieta",
  "Zofia", "Joanna", "Magdalena", "Monika", "Teresa", "Danuta", "Natalia", "Aleksandra", "Karolina", "Marta", "Beata",
  "Julia", "Zuzanna", "Hanna", "Lena", "Maja", "Alicja", "Oliwia", "Weronika", "Dorota", "Renata", "Halina", "Iwona"];
const MALE = ["Jan", "Piotr", "Krzysztof", "Andrzej", "Tomasz", "Paweł", "Marcin", "Michał", "Marek", "Grzegorz",
  "Józef", "Łukasz", "Adam", "Zbigniew", "Jerzy", "Tadeusz", "Mateusz", "Dariusz", "Mariusz", "Wojciech", "Ryszard",
  "Jakub", "Kacper", "Szymon", "Antoni", "Filip", "Franciszek", "Stanisław", "Kamil", "Dawid", "Bartłomiej", "Henryk"];
// Surnames ending in -ski/-cki/-dzki change in the feminine; the rest stay the same.
const LAST = ["Nowak", "Kowalski", "Wiśniewski", "Wójcik", "Kowalczyk", "Kamiński", "Lewandowski", "Zieliński",
  "Szymański", "Woźniak", "Dąbrowski", "Kozłowski", "Jankowski", "Mazur", "Kwiatkowski", "Krawczyk", "Piotrowski",
  "Grabowski", "Nowakowski", "Pawłowski", "Michalski", "Nowicki", "Adamczyk", "Dudek", "Zając", "Wieczorek",
  "Jabłoński", "Król", "Majewski", "Olszewski", "Jaworski", "Wróbel", "Malinowski", "Pawlak", "Witkowski", "Walczak",
  "Stępień", "Górski", "Rutkowski", "Michalak", "Sikora", "Ostrowski", "Baran", "Duda", "Szewczyk", "Tomaszewski",
  "Pietrzak", "Marciniak", "Wróblewski", "Zalewski", "Jakubowski", "Jasiński", "Zawadzki", "Sadowski", "Bąk",
  "Chmielewski", "Włodarczyk", "Borkowski", "Czarnecki", "Sawicki", "Sokołowski", "Urbański", "Kubiak", "Maciejewski",
  "Szczepański", "Kucharski", "Wilk", "Kalinowski", "Lis", "Mazurek", "Wysocki", "Adamski", "Kaźmierczak", "Wasilewski",
  "Sobczak", "Czerwiński", "Andrzejewski", "Cieślak", "Głowacki", "Zakrzewski", "Kołodziej", "Sikorski", "Krajewski",
  "Gajewski", "Szymczak", "Szulc", "Baranowski", "Laskowski", "Brzeziński", "Makowski", "Ziółkowski", "Przybylski"];
const feminine = (name: string) => name.replace(/(ski|cki|dzki)$/, (m) => `${m.slice(0, -1)}a`);
const FLAGS = ["cukrzyca", "nadciśnienie", "choroby serca", "alergia na penicylinę", "leki przeciwzakrzepowe", "astma", "padaczka"];
const NOTES = ["Preferuje wizyty po 15:00.", "Boi się zabiegów, spokojnie tłumaczyć każdy krok.", "Kontakt przez córkę.",
  "Prosi o SMS zamiast telefonu.", "Przychodzi z dwójką dzieci, umawiać kolejno.", "Pracuje na zmiany, termin potwierdzać dzień wcześniej.",
  "Słabo słyszy, mówić wyraźnie.", "Faktura na firmę."];
// Mobile prefixes; with the multiplier below every patient gets a different number.
const MOBILE = ["50", "51", "53", "57", "60", "66", "69", "72", "78", "79", "88"];
const ascii = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/ł/g, "l");

function patients(today: Date) {
  const cols = {
    first: [] as string[], last: [] as string[], phone: [] as (string | null)[], email: [] as (string | null)[],
    birth: [] as string[], flags: [] as string[], notes: [] as (string | null)[], sms: [] as boolean[], created: [] as string[],
  };
  for (let i = 0; i < SCALE.patients; i++) {
    const female = chance(0.54);
    const first = pick(female ? FEMALE : MALE);
    const lastBase = pick(LAST);
    const last = female ? feminine(lastBase) : lastBase;
    // Ages 3 to 90, most adults between 25 and 65.
    const age = Math.min(90, Math.max(3, Math.round(45 + (rand() + rand() + rand() - 1.5) * 34)));
    const birth = new Date(Date.UTC(today.getUTCFullYear() - age, Math.floor(rand() * 12), 1 + Math.floor(rand() * 28)));
    const flags: string[] = [];
    if (chance(0.12)) flags.push(pick(FLAGS));
    if (chance(0.02)) flags.push(pick(FLAGS));
    if (female && age >= 20 && age <= 42 && chance(0.03)) flags.push("ciąża");
    cols.first.push(first);
    cols.last.push(last);
    cols.phone.push(chance(0.97) ? `+48${MOBILE[i % MOBILE.length]}${String((i * 104_729) % 10_000_000).padStart(7, "0")}` : null);
    cols.email.push(age >= 18 && chance(0.35) ? `${ascii(first)}.${ascii(last)}${i % 100}@example.com` : null);
    cols.birth.push(birth.toISOString().slice(0, 10));
    cols.flags.push([...new Set(flags)].join("|"));
    cols.notes.push(chance(0.03) ? pick(NOTES) : null);
    cols.sms.push(chance(0.88));
    cols.created.push(new Date(today.getTime() - rand() * 12 * 365 * 86_400_000).toISOString());
  }
  return cols;
}

// --- appointments --------------------------------------------------------------------------------------
type Block = { staff: number; site: Site; offset: number; day: string; start: number; end: number };
type Visit = { staff: number; site: Site; day: string; start: number; length: number; service: number; offset: number };

/** Share of a fully booked day that is already booked, by days from today. */
function booked(offset: number): number {
  if (offset <= 7) return 0.97;
  if (offset <= 21) return 0.7;
  if (offset <= 42) return 0.4;
  return 0.15;
}

/** Packs every work block with back-to-back visits, then keeps about as many as the clinic sees in a day. */
function visitsForDay(blocks: Block[], staffIdx: Map<number, number>, weekday: number): Visit[] {
  const candidates: Visit[] = [];
  for (const b of blocks) {
    const specialty = STAFF[staffIdx.get(b.staff)!].specialty;
    let minute = b.start;
    while (true) {
      const service = pickService(specialty);
      const length = service < 0 ? 30 : SERVICES[service][2];
      if (minute + length > b.end) break;
      candidates.push({ staff: b.staff, site: b.site, day: b.day, start: minute, length, service, offset: b.offset });
      minute += length;
    }
  }
  const full = weekday === 6 ? SCALE.visitsPerSaturday : SCALE.visitsPerWeekday;
  const wanted = Math.round(full * booked(blocks[0].offset) * (0.85 + rand() * 0.3));
  return shuffle(candidates).slice(0, wanted);
}

function status(v: Visit, nowMinute: number): string {
  const past = v.offset < 0 || (v.offset === 0 && v.start + v.length <= nowMinute);
  const r = rand();
  if (past) return r < 0.86 ? "done" : r < 0.93 ? "cancelled" : "no_show";
  if (r < 0.06) return "cancelled";
  return v.offset <= 2 && r < 0.65 ? "confirmed" : "booked";
}

// --- database ------------------------------------------------------------------------------------------
async function insertMany(client: Queryable, sql: string, columns: unknown[][], size = 2000) {
  for (let from = 0; from < columns[0].length; from += size) {
    await client.query(sql, columns.map((c) => c.slice(from, from + size)));
  }
}
type Queryable = Pick<Db, "query">;

/** Empties every table the demo seed fills. Logins and sessions stay, so a signed-in browser stays signed in. */
async function resetDemo(client: Queryable) {
  await client.query(`TRUNCATE appointments, schedules, work_patterns, staff_sites, patients, services,
                        opening_hours, opening_exceptions, import_refs, audit_log RESTART IDENTITY`);
  await client.query("UPDATE users SET staff_id = NULL");
  await client.query("DELETE FROM staff");
  await client.query("ALTER SEQUENCE staff_id_seq RESTART");
}

async function seedAll(client: Queryable) {
  const clock = (
    await client.query<{ today: string; minute: number }>(
      `SELECT to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS today,
              (extract(hour FROM now() AT TIME ZONE '${TZ}') * 60 + extract(minute FROM now() AT TIME ZONE '${TZ}'))::int AS minute`,
    )
  ).rows[0];
  const today = new Date(`${clock.today}T00:00:00Z`);

  // Opening hours and holidays.
  const week: Array<[Site, number, string, string]> = [
    ...[1, 2, 3, 4, 5].map((d) => ["turek", d, "08:00", "20:00"] as [Site, number, string, string]),
    ["turek", 6, "09:00", "13:00"],
    ...[1, 2, 3, 4, 5].map((d) => ["poddebice", d, "09:00", "18:00"] as [Site, number, string, string]),
  ];
  for (const [site, weekday, opens, closes] of week) {
    await client.query("INSERT INTO opening_hours VALUES ($1, $2, $3, $4)", [site, weekday, opens, closes]);
  }
  const year = today.getUTCMonth() === 11 && today.getUTCDate() > 26 ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
  const holidays: Array<[string, string | null, string | null, string]> = [
    [`${year}-12-24`, null, null, "Wigilia"],
    [`${year}-12-25`, null, null, "Boże Narodzenie"],
    [`${year}-12-26`, null, null, "Drugi dzień świąt"],
    [`${year}-12-31`, "08:00", "13:00", "Sylwester, krócej"],
  ];
  for (const site of ["turek", "poddebice"]) {
    for (const [day, opens, closes, note] of holidays) {
      await client.query("INSERT INTO opening_exceptions VALUES ($1, $2, $3, $4, $5)", [site, day, opens, closes, note]);
    }
  }

  // Staff, sites and weekly patterns.
  const staffIds: number[] = [];
  for (const [i, s] of STAFF.entries()) {
    const id = (
      await client.query<{ id: number }>(
        "INSERT INTO staff (name, kind, title, sort_order, color) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [s.name, s.kind ?? "person", s.title || null, i + 1, STAFF_PALETTE[i % STAFF_PALETTE.length]],
      )
    ).rows[0].id;
    for (const site of s.sites) await client.query("INSERT INTO staff_sites VALUES ($1, $2)", [id, site]);
    staffIds.push(id);
  }
  const staffIdx = new Map(staffIds.map((id, i) => [id, i]));
  const patterns = workPatterns();
  await insertMany(
    client,
    `INSERT INTO work_patterns (staff_id, weekday, site_id, starts, ends)
     SELECT * FROM unnest($1::int[], $2::smallint[], $3::text[], $4::time[], $5::time[])`,
    [patterns.map((p) => staffIds[p.staff]), patterns.map((p) => p.weekday), patterns.map((p) => p.site),
     patterns.map((p) => p.starts), patterns.map((p) => p.ends)],
  );

  // Working hours from the patterns, the same way Settings generates them (closed days skipped).
  await client.query(
    `INSERT INTO schedules (staff_id, site_id, starts_at, ends_at, kind)
     SELECT p.staff_id, p.site_id, (d::date + p.starts) AT TIME ZONE '${TZ}', (d::date + p.ends) AT TIME ZONE '${TZ}', 'work'
       FROM generate_series($1::date - $2::int, $1::date + $3::int, interval '1 day') d
       JOIN work_patterns p ON p.weekday = extract(isodow FROM d)
      WHERE NOT EXISTS (SELECT 1 FROM opening_exceptions e WHERE e.site_id = p.site_id AND e.day = d::date AND e.opens IS NULL)`,
    [clock.today, SCALE.daysBack, SCALE.daysAhead],
  );
  // A few holidays ("urlop"): those days are absences with no visits.
  for (const [staff, from, to] of [[3, 9, 13], [12, 20, 24], [16, -30, -26], [6, 2, 4]]) {
    await client.query(
      `UPDATE schedules SET kind = 'absence'
        WHERE staff_id = $1 AND (starts_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date + $3::int AND $2::date + $4::int`,
      [staffIds[staff], clock.today, from, to],
    );
  }

  // Services.
  const serviceIds: number[] = [];
  for (const [i, [category, name, minutes, min, max, note]] of SERVICES.entries()) {
    serviceIds.push(
      (
        await client.query<{ id: number }>(
          `INSERT INTO services (category, name, duration_minutes, price_min, price_max, price_note, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [category, name, minutes, min, max, note, i + 1],
        )
      ).rows[0].id,
    );
  }

  // Patients.
  const p = patients(today);
  await insertMany(
    client,
    `INSERT INTO patients (first_name, last_name, phone, email, birth_date, medical_flags, notes, sms_consent, created_at, updated_at)
     SELECT f, l, ph, em, b, coalesce(string_to_array(nullif(fl, ''), '|'), '{}'), n, s, c, c
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::date[], $6::text[], $7::text[], $8::bool[], $9::timestamptz[])
         AS t(f, l, ph, em, b, fl, n, s, c)`,
    [p.first, p.last, p.phone, p.email, p.birth, p.flags, p.notes, p.sms, p.created],
  );
  const patientIds = (await client.query<{ id: number }>("SELECT id FROM patients ORDER BY id")).rows.map((r) => r.id);

  // Visits: about 45 a working day across both sites, fully booked this week, thinner further ahead.
  const blocks = (
    await client.query<Block & { weekday: number }>(
      `SELECT staff_id AS staff, site_id AS site,
              ((starts_at AT TIME ZONE '${TZ}')::date - $1::date) AS "offset",
              to_char(starts_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day,
              extract(isodow FROM starts_at AT TIME ZONE '${TZ}')::int AS weekday,
              (extract(epoch FROM (starts_at AT TIME ZONE '${TZ}')::time) / 60)::int AS start,
              (extract(epoch FROM (ends_at AT TIME ZONE '${TZ}')::time) / 60)::int AS "end"
         FROM schedules WHERE kind = 'work' ORDER BY starts_at, staff_id`,
      [clock.today],
    )
  ).rows;
  const byDay = new Map<string, Array<Block & { weekday: number }>>();
  for (const b of blocks) byDay.set(b.day, [...(byDay.get(b.day) ?? []), b]);
  const visits = [...byDay.values()].flatMap((day) => visitsForDay(day, staffIdx, day[0].weekday));
  await insertMany(
    client,
    `INSERT INTO appointments (site_id, staff_id, patient_id, service_id, title, starts_at, ends_at, status, source, created_at, updated_at)
     SELECT site, staff, patient, service, title,
            (day + make_interval(mins => start)) AT TIME ZONE '${TZ}',
            (day + make_interval(mins => start + length)) AT TIME ZONE '${TZ}',
            status, source, created, created
       FROM unnest($1::text[], $2::int[], $3::int[], $4::int[], $5::text[], $6::date[], $7::int[], $8::int[], $9::text[], $10::text[], $11::timestamptz[])
         AS t(site, staff, patient, service, title, day, start, length, status, source, created)`,
    [
      visits.map((v) => v.site),
      visits.map((v) => v.staff),
      visits.map(() => pick(patientIds)),
      visits.map((v) => (v.service < 0 ? null : serviceIds[v.service])),
      visits.map((v) => (v.service < 0 ? "Usługa spoza cennika" : null)),
      visits.map((v) => v.day),
      visits.map((v) => v.start),
      visits.map((v) => v.length),
      visits.map((v) => status(v, clock.minute)),
      visits.map(() => (chance(0.08) ? "bot" : "desk")),
      // Booked one to five weeks before the visit (never in the future).
      visits.map((v) => new Date(Math.min(Date.now(), today.getTime() + (v.offset - 7 - rand() * 28) * 86_400_000)).toISOString()),
    ],
  );
  return { staff: STAFF.length, services: SERVICES.length, patients: patientIds.length, visits: visits.length };
}

const db = createPool();
try {
  await migrate(db);
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM patients");
  if (rows[0].n > 0) {
    // Only a database this script filled (it has the demo admin) may be emptied: never real clinic data.
    const demo = await db.query("SELECT 1 FROM users WHERE login = 'admin' AND name = $1", [DEMO_ADMIN_NAME]);
    if (!demo.rowCount) {
      console.error("database already has patients: demo seed only runs on an empty database");
      process.exit(1);
    }
    if (rows[0].n >= SCALE.patients) {
      console.log("demo data already at full scale, nothing to do");
      process.exit(0);
    }
    console.log(`demo data: replacing the small demo set (${rows[0].n} patients)`);
  }

  // One transaction: a failed run leaves the database as it was.
  const client = await db.connect();
  const counts = await (async () => {
    try {
      await client.query("BEGIN");
      if (rows[0].n > 0) await resetDemo(client);
      const result = await seedAll(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })();

  for (const [login, name, role] of [["recepcja", "Recepcja (demo)", "reception"], ["admin", DEMO_ADMIN_NAME, "admin"]] as const) {
    const has = await db.query("SELECT 1 FROM users WHERE login = $1", [login]);
    if (!has.rowCount) await createUser(db, { login, name, role, password: DEMO_PASSWORD });
  }
  console.log(
    `demo data: ${counts.staff} staff, ${counts.services} services, ${counts.patients} patients, ${counts.visits} visits, logins recepcja/admin`,
  );
} finally {
  await db.end();
}

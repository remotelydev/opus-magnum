// Fills an EMPTY database with made-up demo data (no real patients) for development and screenshots.
//   DATABASE_URL=... pnpm --filter horarium seed:demo
import { createUser } from "../src/auth.js";
import { createPool, migrate } from "../src/db.js";

const DEMO_PASSWORD = process.env.CLINIC_PASSWORD ?? "demo-demo-demo";
const DEMO_ADMIN_NAME = "Administrator (demo)";

const TITLES: Record<string, string> = {
  "lek. dent. Anna Demo": "lekarz dentysta",
  "lek. dent. Piotr Przykład": "lekarz dentysta, endodonta",
  "lek. dent. Ewa Testowa": "lekarz dentysta, ortodonta",
  "lek. dent. Marek Próbny": "lekarz dentysta, chirurg",
};

/** Made-up opening hours, holidays, staff titles and weekly patterns (the demo staff work Mon-Fri 8-16). */
async function seedSettings(db: ReturnType<typeof createPool>) {
  const week: Array<[string, number, string, string]> = [
    ...[1, 2, 3, 4, 5].map((d) => ["turek", d, "08:00", "20:00"] as [string, number, string, string]),
    ["turek", 6, "09:00", "13:00"],
    ...[1, 2, 3, 4, 5].map((d) => ["poddebice", d, "09:00", "18:00"] as [string, number, string, string]),
  ];
  for (const [site, weekday, opens, closes] of week) {
    await db.query("INSERT INTO opening_hours VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [site, weekday, opens, closes]);
  }
  const now = new Date();
  const year = now.getUTCMonth() === 11 && now.getUTCDate() > 26 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const holidays: Array<[string, string | null, string | null, string]> = [
    [`${year}-12-24`, null, null, "Wigilia"],
    [`${year}-12-25`, null, null, "Boże Narodzenie"],
    [`${year}-12-26`, null, null, "Drugi dzień świąt"],
    [`${year}-12-31`, "08:00", "13:00", "Sylwester, krócej"],
  ];
  for (const site of ["turek", "poddebice"]) {
    for (const [day, opens, closes, note] of holidays) {
      await db.query("INSERT INTO opening_exceptions VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING", [site, day, opens, closes, note]);
    }
  }
  const { rows } = await db.query<{ id: number; name: string; site: string }>(
    `SELECT st.id, st.name, min(ss.site_id) AS site FROM staff st JOIN staff_sites ss ON ss.staff_id = st.id
      GROUP BY st.id ORDER BY st.id`,
  );
  for (const [i, s] of rows.entries()) {
    await db.query("UPDATE staff SET title = COALESCE(title, $2), sort_order = $3 WHERE id = $1", [
      s.id,
      TITLES[s.name] ?? (s.name === "Higienizacja" ? null : "lekarz dentysta"),
      i + 1,
    ]);
    const has = await db.query("SELECT 1 FROM work_patterns WHERE staff_id = $1", [s.id]);
    if (has.rowCount) continue;
    // Same site as the working hours the seed writes (Piotr, at both sites, works in Turek).
    const site = s.name === "lek. dent. Piotr Przykład" ? "turek" : s.site;
    for (const weekday of [1, 2, 3, 4, 5]) {
      await db.query("INSERT INTO work_patterns (staff_id, weekday, site_id, starts, ends) VALUES ($1, $2, $3, '08:00', '16:00')", [
        s.id,
        weekday,
        site,
      ]);
    }
  }
}

const db = createPool();
try {
  await migrate(db);
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM patients");
  if (rows[0].n > 0) {
    // A demo database made before the settings existed gets them topped up. Only a database this script
    // created (it has the demo admin) and only while the settings are still empty: never real clinic data.
    const demo = await db.query("SELECT 1 FROM users WHERE login = 'admin' AND name = $1", [DEMO_ADMIN_NAME]);
    const empty = await db.query("SELECT 1 FROM opening_hours LIMIT 1");
    if (demo.rowCount && !empty.rowCount) {
      await seedSettings(db);
      console.log("demo data: added opening hours, holidays, staff titles and work patterns");
      process.exit(0);
    }
    console.error("database already has patients: demo seed only runs on an empty database");
    process.exit(1);
  }

  const staff: Array<[string, string[], "person" | "calendar"]> = [
    ["lek. dent. Anna Demo", ["turek"], "person"],
    ["lek. dent. Piotr Przykład", ["turek", "poddebice"], "person"],
    ["lek. dent. Ewa Testowa", ["turek"], "person"],
    ["Higienizacja", ["turek"], "calendar"],
    ["lek. dent. Marek Próbny", ["poddebice"], "person"],
  ];
  const staffIds: number[] = [];
  for (const [name, sites, kind] of staff) {
    const id = (await db.query<{ id: number }>("INSERT INTO staff (name, kind) VALUES ($1, $2) RETURNING id", [name, kind]))
      .rows[0].id;
    for (const site of sites) await db.query("INSERT INTO staff_sites VALUES ($1, $2)", [id, site]);
    staffIds.push(id);
  }

  const services: Array<[string, string, number, number, number]> = [
    ["Diagnostyka", "Przegląd i konsultacja", 30, 150, 150],
    ["Zachowawcza", "Wypełnienie", 45, 250, 450],
    ["Endodoncja", "Leczenie kanałowe", 90, 900, 1600],
    ["Higienizacja", "Skaling i piaskowanie", 60, 300, 300],
    ["Chirurgia", "Ekstrakcja", 30, 250, 600],
    ["Protetyka", "Wycisk", 30, 200, 200],
  ];
  const serviceIds: number[] = [];
  for (const [category, name, minutes, min, max] of services) {
    serviceIds.push(
      (
        await db.query<{ id: number }>(
          "INSERT INTO services (category, name, duration_minutes, price_min, price_max) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [category, name, minutes, min, max],
        )
      ).rows[0].id,
    );
  }

  const first = ["Jan", "Maria", "Tomasz", "Katarzyna", "Paweł", "Agnieszka", "Michał", "Joanna", "Krzysztof", "Ewa"];
  const last = ["Kowal", "Nowak", "Wiśniewska", "Wójcik", "Kamińska", "Lewandowski", "Zielińska", "Szymański"];
  const patientIds: number[] = [];
  for (let i = 0; i < 40; i++) {
    const phone = `+4860${String(1000000 + i * 7919).slice(-7)}`;
    patientIds.push(
      (
        await db.query<{ id: number }>(
          `INSERT INTO patients (first_name, last_name, phone, sms_consent, medical_flags)
           VALUES ($1, $2, $3, true, $4) RETURNING id`,
          [first[i % first.length], last[i % last.length], phone, i % 9 === 0 ? ["cukrzyca"] : []],
        )
      ).rows[0].id,
    );
  }

  // Working hours for the next 14 days (Mon-Fri 8-16 local), and some visits.
  const today = new Date();
  let made = 0;
  for (let d = -1; d < 14; d++) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + d));
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const date = day.toISOString().slice(0, 10);
    for (const [i, id] of staffIds.entries()) {
      const site = staff[i][1][0];
      await db.query(
        `INSERT INTO schedules (staff_id, site_id, starts_at, ends_at)
         VALUES ($1, $2, ($3::date + time '08:00') AT TIME ZONE 'Europe/Warsaw', ($3::date + time '16:00') AT TIME ZONE 'Europe/Warsaw')`,
        [id, site, date],
      );
      let minute = 8 * 60;
      while (minute < 15 * 60) {
        const s = (made * 7 + i * 3) % services.length;
        const length = services[s][2];
        if ((made + i) % 4 !== 3) {
          const statuses = ["booked", "booked", "confirmed", "confirmed", "cancelled"];
          await db.query(
            `INSERT INTO appointments (site_id, staff_id, patient_id, service_id, starts_at, ends_at, status, source)
             VALUES ($1, $2, $3, $4,
               ($5::date + make_interval(mins => $6)) AT TIME ZONE 'Europe/Warsaw',
               ($5::date + make_interval(mins => $6 + $7)) AT TIME ZONE 'Europe/Warsaw', $8, $9)`,
            [site, id, patientIds[made % patientIds.length], serviceIds[s], date, minute, length,
             statuses[made % statuses.length], made % 11 === 0 ? "bot" : "desk"],
          );
        }
        made++;
        minute += length + (made % 3 === 0 ? 15 : 0);
      }
    }
  }

  await createUser(db, { login: "recepcja", name: "Recepcja (demo)", role: "reception", password: DEMO_PASSWORD });
  await createUser(db, { login: "admin", name: DEMO_ADMIN_NAME, role: "admin", password: DEMO_PASSWORD });
  await seedSettings(db);
  console.log(`demo data: ${staff.length} staff, ${services.length} services, ${patientIds.length} patients, logins recepcja/admin`);
} finally {
  await db.end();
}

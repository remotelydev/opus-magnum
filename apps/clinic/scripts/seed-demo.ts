// Fills an EMPTY database with made-up demo data (no real patients) for development and screenshots.
//   DATABASE_URL=... pnpm --filter clinic seed:demo
import { createUser } from "../src/auth.js";
import { createPool, migrate } from "../src/db.js";

const DEMO_PASSWORD = process.env.CLINIC_PASSWORD ?? "demo-demo-demo";

const db = createPool();
try {
  await migrate(db);
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM patients");
  if (rows[0].n > 0) {
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
  await createUser(db, { login: "admin", name: "Administrator (demo)", role: "admin", password: DEMO_PASSWORD });
  console.log(`demo data: ${staff.length} staff, ${services.length} services, ${patientIds.length} patients, logins recepcja/admin`);
} finally {
  await db.end();
}

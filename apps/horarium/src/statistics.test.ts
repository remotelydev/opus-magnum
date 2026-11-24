import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createUser } from "./auth.js";
import type { Db } from "./db.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";

const PASSWORD = "correct-horse-battery";

describe("statistics, closing visits and the cash register", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: Db;
  let app: FastifyInstance;
  const tokens: Record<string, string> = {};
  let drA: number;
  let drB: number;
  let filling: number;
  let checkup: number;
  let anna: number;
  let jan: number;

  async function call(method: string, url: string, who: string | null, payload?: unknown) {
    const res = await app.inject({
      method: method as "GET",
      url,
      payload: payload as object,
      headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  }

  /** Closes a visit paid in one way; `split` gives the cash part of a cash-and-card payment instead. */
  function close(id: number, who: string, items: { serviceId: number; price: number }[], method: string, split?: number) {
    const total = items.reduce((sum, i) => sum + i.price, 0);
    const payments = split === undefined ? [{ method, amount: total }] : [{ method: "cash", amount: split }, { method: "card", amount: total - split }];
    return call("PUT", `/api/appointments/${id}/checkout`, who, { items, payments });
  }

  async function visit(staffId: number, patientId: number | null, startsAt: string, site = "turek", minutes = 30) {
    const ends = new Date(Date.parse(startsAt) + minutes * 60_000).toISOString();
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO appointments (site_id, staff_id, patient_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [site, staffId, patientId, startsAt, ends],
    );
    return rows[0].id;
  }

  before(async () => {
    db = await freshDb();
    app = buildApp(db);
    const staff = await db.query<{ id: number }>("INSERT INTO staff (name) VALUES ('Dr A'), ('Dr B') RETURNING id");
    [drA, drB] = staff.rows.map((r) => r.id);
    await db.query("INSERT INTO staff_sites VALUES ($1, 'turek'), ($1, 'poddebice'), ($2, 'turek')", [drA, drB]);
    const services = await db.query<{ id: number }>(
      `INSERT INTO services (category, name, duration_minutes, price_min, price_max)
       VALUES ('Stomatologia', 'Wypełnienie', 30, 250, 400), ('Stomatologia', 'Przegląd', 15, 100, 100) RETURNING id`,
    );
    [filling, checkup] = services.rows.map((r) => r.id);
    const patients = await db.query<{ id: number }>(
      "INSERT INTO patients (first_name, last_name) VALUES ('Anna', 'Nowak'), ('Jan', 'Kowal') RETURNING id",
    );
    [anna, jan] = patients.rows.map((r) => r.id);
    await createUser(db, { login: "admin", name: "Admin", role: "admin", password: PASSWORD });
    await createUser(db, { login: "recepcja", name: "Recepcja", role: "reception", password: PASSWORD });
    await createUser(db, { login: "dr.a", name: "Dr A", role: "doctor", password: PASSWORD, staffId: drA });
    await createUser(db, { login: "higienistka", name: "Higienistka", role: "hygienist", password: PASSWORD, staffId: drB });
    await createUser(db, { login: "bartosz", name: "Bartosz", role: "admin", password: PASSWORD, features: ["hidden_reports"] });
    for (const login of ["admin", "recepcja", "dr.a", "higienistka", "bartosz"]) {
      const res = await call("POST", "/api/auth/login", null, { login, password: PASSWORD });
      assert.equal(res.status, 200);
      tokens[login] = res.body.token;
    }
  });

  after(async () => {
    await app.close();
    await db.end();
  });

  test("a login carries its features", async () => {
    assert.deepEqual((await call("GET", "/api/me", "bartosz")).body.features, ["hidden_reports"]);
    assert.deepEqual((await call("GET", "/api/me", "admin")).body.features, []);
  });

  test("reception closes a visit: services with changed prices, one payment, status done", async () => {
    const id = await visit(drA, anna, "2026-11-02T09:00:00Z");
    const closed = await close(id, "recepcja", [{ serviceId: filling, price: 300 }, { serviceId: checkup, price: 100 }], "cash");
    assert.equal(closed.status, 200);
    assert.equal(closed.body.total, 400);
    const back = await call("GET", `/api/appointments/${id}/checkout`, "recepcja");
    assert.deepEqual(back.body, {
      items: [
        { serviceId: filling, name: "Wypełnienie", price: 300 },
        { serviceId: checkup, name: "Przegląd", price: 100 },
      ],
      payments: [{ method: "cash", amount: 400 }],
    });
    const row = (await db.query("SELECT status, service_id FROM appointments WHERE id = $1", [id])).rows[0];
    assert.deepEqual(row, { status: "done", service_id: filling });

    // Closing again replaces, never adds up.
    await close(id, "recepcja", [{ serviceId: filling, price: 280 }], "card");
    const pays = await db.query("SELECT method, amount::float AS amount FROM appointment_payments WHERE appointment_id = $1", [id]);
    assert.deepEqual(pays.rows, [{ method: "card", amount: 280 }]);
    await close(id, "recepcja", [{ serviceId: filling, price: 300 }], "cash");
  });

  test("a payment can be split between cash and card; the parts must add up", async () => {
    const id = await visit(drB, anna, "2027-02-01T09:00:00Z");
    const items = [{ serviceId: filling, price: 400 }];
    assert.equal((await close(id, "recepcja", items, "cash", 150)).status, 200);
    const back = await call("GET", `/api/appointments/${id}/checkout`, "recepcja");
    assert.deepEqual(back.body.payments, [{ method: "cash", amount: 150 }, { method: "card", amount: 250 }]);
    const wrong = await call("PUT", `/api/appointments/${id}/checkout`, "recepcja", {
      items,
      payments: [{ method: "cash", amount: 100 }, { method: "card", amount: 100 }],
    });
    assert.equal(wrong.status, 400);
    const twice = await call("PUT", `/api/appointments/${id}/checkout`, "recepcja", {
      items,
      payments: [{ method: "cash", amount: 200 }, { method: "cash", amount: 200 }],
    });
    assert.equal(twice.status, 400);
  });

  test("closing needs services from the price list and cash or card; a doctor closes only their own visits", async () => {
    const id = await visit(drA, jan, "2026-11-03T09:00:00Z");
    assert.equal((await close(id, "recepcja", [], "cash")).status, 400);
    assert.equal((await close(id, "recepcja", [{ serviceId: filling, price: 1 }], "blik")).status, 400);
    assert.equal((await close(id, "recepcja", [{ serviceId: 9999, price: 1 }], "cash")).status, 400);
    const other = await visit(drB, jan, "2027-01-04T09:00:00Z");
    assert.equal((await close(other, "dr.a", [{ serviceId: filling, price: 1 }], "cash")).status, 403);
    const own = await visit(drA, jan, "2027-01-04T09:00:00Z");
    // The hygienist's login is tied to Dr B's card here: Dr B's visits are hers, Dr A's are not.
    assert.equal((await close(own, "higienistka", [{ serviceId: filling, price: 1 }], "cash")).status, 403);
    const hers = await visit(drB, anna, "2027-01-05T09:00:00Z", "poddebice");
    assert.equal((await close(hers, "higienistka", [{ serviceId: checkup, price: 100 }], "card")).status, 200);
    assert.equal((await close(own, "dr.a", [{ serviceId: filling, price: 250 }], "cash")).status, 200);
    const block = await visit(drB, null, "2026-11-03T12:00:00Z");
    assert.equal((await close(block, "recepcja", [{ serviceId: filling, price: 1 }], "cash")).status, 400);
  });

  test("financial report: visits, time, money and payment methods; per clinic and both", async () => {
    // Dr B in Turek, card; Dr A in Poddębice, an imported visit paid by transfer.
    const b = await visit(drB, jan, "2026-11-04T09:00:00Z", "turek", 60);
    await close(b, "recepcja", [{ serviceId: checkup, price: 150 }], "card");
    const old = await visit(drA, jan, "2026-11-05T09:00:00Z", "poddebice", 45);
    await db.query("UPDATE appointments SET status = 'done', source = 'import' WHERE id = $1", [old]);
    await db.query("INSERT INTO appointment_payments (appointment_id, method, method_label, amount, source) VALUES ($1, 'transfer', 'przelew', 500, 'import')", [old]);
    // Not counted: booked, and outside the range.
    await visit(drA, anna, "2026-11-06T09:00:00Z");
    const late = await visit(drA, anna, "2026-12-01T09:00:00Z");
    await close(late, "recepcja", [{ serviceId: checkup, price: 100 }], "cash");

    const all = (await call("GET", "/api/stats/financial?site=all&from=2026-11-01&to=2026-11-30", "admin")).body;
    assert.deepEqual(all.totals, { visits: 3, minutes: 135, revenue: 950 });
    assert.deepEqual(
      all.methods.map((m: { method: string; amount: number }) => [m.method, m.amount]),
      [["transfer", 500], ["cash", 300], ["card", 150]],
    );
    assert.equal(all.methods.find((m: { method: string }) => m.method === "cash").label, "gotówka");
    const turek = (await call("GET", "/api/stats/financial?site=turek&from=2026-11-01&to=2026-11-30", "admin")).body;
    assert.deepEqual(turek.totals, { visits: 2, minutes: 90, revenue: 450 });
  });

  test("a doctor sees only their own numbers; reception and hygienists see no statistics", async () => {
    const mine = (await call("GET", "/api/stats/financial?site=all&from=2026-11-01&to=2026-11-30", "dr.a")).body;
    assert.deepEqual(mine.staff.map((r: { staffId: number }) => r.staffId).sort(), [drA, drA]);
    assert.deepEqual(mine.totals, { visits: 2, minutes: 75, revenue: 800 });
    for (const who of ["recepcja", "higienistka"]) {
      for (const report of ["financial", "services", "returning", "worktime"]) {
        assert.equal((await call("GET", `/api/stats/${report}?site=all&from=2026-11-01&to=2026-11-30`, who)).status, 403, `${who} ${report}`);
      }
    }
    assert.equal((await call("GET", "/api/cash?site=turek&from=2026-11-01&to=2026-11-30", "dr.a")).status, 403);
    const doctorWithoutCard = await createUser(db, { login: "dr.x", name: "Dr X", role: "doctor", password: PASSWORD });
    assert.ok(doctorWithoutCard);
    const x = await call("POST", "/api/auth/login", null, { login: "dr.x", password: PASSWORD });
    tokens["dr.x"] = x.body.token;
    assert.equal((await call("GET", "/api/stats/financial?site=all&from=2026-11-01&to=2026-11-30", "dr.x")).status, 403);
  });

  test("service popularity: closed services, Versum's off-list history and waiting visits", async () => {
    const rows = (await call("GET", "/api/stats/services?site=all&from=2026-11-01&to=2026-11-30", "admin")).body as {
      done: boolean; name: string; count: number; amount: number;
    }[];
    const sum = (done: boolean, name: string) =>
      rows.filter((r) => r.done === done && r.name === name).reduce((acc, r) => [acc[0] + r.count, acc[1] + r.amount], [0, 0]);
    assert.deepEqual(sum(true, "Wypełnienie"), [1, 300]);
    assert.deepEqual(sum(true, "Przegląd"), [1, 150]);
    assert.deepEqual(sum(true, "Usługa spoza cennika"), [1, 500]);
    assert.deepEqual(sum(false, "Usługa spoza cennika"), [2, 0]);
  });

  test("returning clients: new ones and whether they came back to the clinic and to the same doctor", async () => {
    // Anna: first visit 2.11 with Dr A, back on 1.12 with Dr A. Jan: first 4.11 with Dr B, back 5.11 with Dr A.
    const rows = (await call("GET", "/api/stats/returning?site=all&from=2026-11-01&to=2026-11-04", "admin")).body;
    const byStaff = Object.fromEntries(rows.map((r: { staffId: number }) => [r.staffId, r]));
    assert.deepEqual(byStaff[drA], { staffId: drA, served: 1, new: 1, backToClinic: 1, backToStaff: 1 });
    assert.deepEqual(byStaff[drB], { staffId: drB, served: 1, new: 1, backToClinic: 1, backToStaff: 0 });
  });

  test("work time: planned hours and days off from the schedule, time at visits", async () => {
    await db.query(
      `INSERT INTO schedules (staff_id, site_id, starts_at, ends_at, kind) VALUES
         ($1, 'turek', '2026-11-02T07:00:00Z', '2026-11-02T15:00:00Z', 'work'),
         ($1, 'poddebice', '2026-11-05T07:00:00Z', '2026-11-05T11:00:00Z', 'work'),
         ($1, 'turek', '2026-11-09T00:00:00Z', '2026-11-09T22:00:00Z', 'absence')`,
      [drA],
    );
    const rows = (await call("GET", "/api/stats/worktime?site=all&from=2026-11-01&to=2026-11-30", "admin")).body;
    assert.deepEqual(rows.find((r: { staffId: number }) => r.staffId === drA), {
      staffId: drA, workMinutes: 720, workDays: 2, absenceDays: 1, visitMinutes: 75,
    });
    const turek = (await call("GET", "/api/stats/worktime?site=turek&from=2026-11-01&to=2026-11-30", "admin")).body;
    assert.equal(turek.find((r: { staffId: number }) => r.staffId === drA).workMinutes, 480);
  });

  test("cash register: counted balance plus cash at visits and money in, minus money out", async () => {
    assert.equal((await call("POST", "/api/cash", "recepcja", { siteId: "turek", kind: "in", amount: 10 })).status, 403);
    assert.equal((await call("GET", "/api/cash?site=all&from=2026-11-01&to=2026-11-30", "admin")).status, 400);
    // Before anyone counts it: all cash ever taken in Turek (300 on 2.11, 100 on 1.12, and in 2027 250 and
    // the cash part 150 of a split payment). The list shows cash by when it was taken: the 2027 visits
    // were paid today.
    let cash = (await call("GET", "/api/cash?site=turek&from=2026-11-01&to=2026-12-31", "admin")).body;
    assert.equal(cash.balance, 800);
    assert.equal(cash.open, false);
    assert.equal(cash.visits.length, 4);
    assert.equal(cash.visits[0].patientName, "Anna Nowak");

    assert.equal((await call("POST", "/api/cash", "admin", { siteId: "turek", kind: "open", amount: 1000 })).status, 201);
    await call("POST", "/api/cash", "admin", { siteId: "turek", kind: "in", amount: 50, note: "rozmienione" });
    await call("POST", "/api/cash", "admin", { siteId: "turek", kind: "out", amount: 20, note: "kawa" });
    const id = await visit(drB, anna, new Date().toISOString());
    await close(id, "recepcja", [{ serviceId: checkup, price: 100 }], "cash");
    const today = new Date().toISOString().slice(0, 10);
    cash = (await call("GET", `/api/cash?site=turek&from=${today}&to=${today}`, "admin")).body;
    assert.equal(cash.balance, 1130);
    assert.equal(cash.open, true);
    assert.deepEqual(cash.operations.map((o: { kind: string }) => o.kind).sort(), ["in", "open", "out"]);
    // Poddębice has its own register.
    assert.equal((await call("GET", `/api/cash?site=poddebice&from=${today}&to=${today}`, "admin")).body.balance, 0);
  });

  test("hygienists write the treatment description but do not book", async () => {
    const id = await visit(drB, jan, "2026-11-20T09:00:00Z");
    assert.equal((await call("PUT", `/api/appointments/${id}/treatment`, "higienistka", { text: "Skaling" })).status, 200);
    assert.equal((await call("PATCH", `/api/appointments/${id}`, "higienistka", { notes: "x" })).status, 403);
  });
});

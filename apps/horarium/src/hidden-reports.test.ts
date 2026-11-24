import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createUser } from "./auth.js";
import type { Db } from "./db.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";

const PASSWORD = "correct-horse-battery";
const RANGE = "site=all&from=2026-11-01&to=2026-11-30";

describe("hidden reports: client origins and commissions", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: Db;
  let app: FastifyInstance;
  const tokens: Record<string, string> = {};
  let drA: number;
  let drB: number;
  let filling: number;
  let anna: number;
  let jan: number;
  let ewa: number;

  async function call(method: string, url: string, who: string, payload?: unknown) {
    const res = await app.inject({ method: method as "GET", url, payload: payload as object, headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  }

  async function paidVisit(staffId: number, patientId: number, startsAt: string, amount: number, site = "turek") {
    const ends = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString();
    const { rows } = await db.query<{ id: number }>(
      "INSERT INTO appointments (site_id, staff_id, patient_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [site, staffId, patientId, startsAt, ends],
    );
    const res = await call("PUT", `/api/appointments/${rows[0].id}/checkout`, "recepcja", {
      items: [{ serviceId: filling, price: amount }],
      payments: [{ method: "cash", amount }],
    });
    assert.equal(res.status, 200);
  }

  before(async () => {
    db = await freshDb();
    app = buildApp(db);
    const staff = await db.query<{ id: number }>("INSERT INTO staff (name) VALUES ('Dr A'), ('Dr B') RETURNING id");
    [drA, drB] = staff.rows.map((r) => r.id);
    await db.query("INSERT INTO staff_sites VALUES ($1, 'turek'), ($1, 'poddebice'), ($2, 'turek')", [drA, drB]);
    filling = (
      await db.query<{ id: number }>(
        "INSERT INTO services (category, name, duration_minutes, price_min, price_max) VALUES ('Stomatologia', 'Wypełnienie', 30, 250, 400) RETURNING id",
      )
    ).rows[0].id;
    const patients = await db.query<{ id: number }>(
      `INSERT INTO patients (first_name, last_name, origin) VALUES ('Anna', 'Nowak', 'Facebook'), ('Jan', 'Kowal', 'Facebook'), ('Ewa', 'Lis', NULL)
       RETURNING id`,
    );
    [anna, jan, ewa] = patients.rows.map((r) => r.id);
    await createUser(db, { login: "admin", name: "Admin", role: "admin", password: PASSWORD });
    await createUser(db, { login: "recepcja", name: "Recepcja", role: "reception", password: PASSWORD });
    await createUser(db, { login: "bartosz", name: "Bartosz", role: "admin", password: PASSWORD, features: ["hidden_reports"] });
    for (const login of ["admin", "recepcja", "bartosz"]) {
      const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login, password: PASSWORD } });
      tokens[login] = res.json().token;
    }
    await paidVisit(drA, anna, "2026-11-02T09:00:00Z", 300);
    await paidVisit(drA, anna, "2026-11-09T09:00:00Z", 100, "poddebice");
    await paidVisit(drB, jan, "2026-11-03T09:00:00Z", 200);
    await paidVisit(drB, ewa, "2026-11-04T09:00:00Z", 400);
    await paidVisit(drB, ewa, "2026-12-04T09:00:00Z", 999); // outside the range
  });

  after(async () => {
    await app.close();
    await db.end();
  });

  test("only a login with the feature reaches them, admins included", async () => {
    for (const url of [`/api/stats/origins?${RANGE}`, `/api/stats/commissions?${RANGE}`, "/api/origins", "/api/commissions"]) {
      assert.equal((await call("GET", url, "admin")).status, 403, url);
      assert.equal((await call("GET", url, "recepcja")).status, 403, url);
      assert.equal((await call("GET", url, "bartosz")).status, 200, url);
    }
    assert.equal((await call("PUT", `/api/patients/${ewa}/origin`, "admin", { origin: "Ulotki" })).status, 403);
    assert.equal((await call("PUT", `/api/commissions/${drA}`, "admin", { rate: 10 })).status, 403);
  });

  test("client origins: patients, visits, money and average per origin", async () => {
    const res = await call("GET", `/api/stats/origins?${RANGE}`, "bartosz");
    assert.deepEqual(res.body, [
      { origin: "Facebook", patients: 2, visits: 3, revenue: 600, average: 300 },
      { origin: null, patients: 1, visits: 1, revenue: 400, average: 400 },
    ]);
    const turek = await call("GET", "/api/stats/origins?site=turek&from=2026-11-01&to=2026-11-30", "bartosz");
    assert.equal(turek.body[0].revenue, 500);
  });

  test("an origin is set on the patient card and offered from those in use", async () => {
    const set = await call("PUT", `/api/patients/${ewa}/origin`, "bartosz", { origin: "  Ulotki " });
    assert.deepEqual(set.body, { ok: true, origin: "Ulotki" });
    assert.deepEqual((await call("GET", "/api/origins", "bartosz")).body, [
      { origin: "Facebook", patients: 2 },
      { origin: "Ulotki", patients: 1 },
    ]);
    assert.equal((await call("GET", `/api/patients/${ewa}`, "recepcja")).body.origin, "Ulotki");
    await call("PUT", `/api/patients/${ewa}/origin`, "bartosz", { origin: "" });
    assert.equal((await call("GET", `/api/patients/${ewa}`, "recepcja")).body.origin, null);
    assert.equal((await call("PUT", "/api/patients/99999/origin", "bartosz", { origin: "x" })).status, 404);
  });

  test("commissions: the rate of each person applied to what was paid for their visits", async () => {
    assert.equal((await call("PUT", `/api/commissions/${drA}`, "bartosz", { rate: 10 })).status, 200);
    assert.equal((await call("PUT", `/api/commissions/${drA}`, "bartosz", { rate: 12.5 })).status, 200);
    assert.equal((await call("PUT", `/api/commissions/${drB}`, "bartosz", { rate: 101 })).status, 400);
    assert.equal((await call("PUT", "/api/commissions/99999", "bartosz", { rate: 5 })).status, 404);
    assert.deepEqual((await call("GET", "/api/commissions", "bartosz")).body, [{ staffId: drA, rate: 12.5 }]);
    const res = await call("GET", `/api/stats/commissions?${RANGE}`, "bartosz");
    const rows = [...res.body].sort((a, b) => a.staffId - b.staffId || a.siteId.localeCompare(b.siteId));
    assert.deepEqual(rows, [
      { staffId: drA, siteId: "poddebice", visits: 1, revenue: 100, rate: 12.5, commission: 12.5 },
      { staffId: drA, siteId: "turek", visits: 1, revenue: 300, rate: 12.5, commission: 37.5 },
      { staffId: drB, siteId: "turek", visits: 2, revenue: 600, rate: 0, commission: 0 },
    ]);
  });
});

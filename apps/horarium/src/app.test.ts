import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createUser } from "./auth.js";
import { createLoginLimiter } from "./login-limit.js";
import type { Db } from "./db.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";

const PASSWORD = "correct-horse-battery";

describe("horarium API", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: Db;
  let app: FastifyInstance;
  const tokens: Record<string, string> = {};

  async function call(method: string, url: string, who: string | null, payload?: unknown) {
    const res = await app.inject({
      method: method as "GET",
      url,
      payload: payload as object,
      headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  }

  before(async () => {
    db = await freshDb();
    app = buildApp(db, { publicOrigins: ["https://dentaplus.pl"] });
    await createUser(db, { login: "admin", name: "Admin", role: "admin", password: PASSWORD });
    await createUser(db, { login: "recepcja.turek", name: "Recepcja", role: "reception", password: PASSWORD });
    await createUser(db, { login: "dr.kowalska", name: "Dr Kowalska", role: "doctor", password: PASSWORD });
    for (const login of ["admin", "recepcja.turek", "dr.kowalska"]) {
      const res = await call("POST", "/api/auth/login", null, { login, password: PASSWORD });
      assert.equal(res.status, 200);
      tokens[login] = res.body.token;
    }
  });

  after(async () => {
    await app.close();
    await db.end();
  });

  test("rejects a wrong password and anonymous calls", async () => {
    assert.equal((await call("POST", "/api/auth/login", null, { login: "admin", password: "nope" })).status, 401);
    assert.equal((await call("GET", "/api/me", null)).status, 401);
    assert.equal((await call("GET", "/api/me", "recepcja.turek")).body.role, "reception");
  });

  test("only admin manages staff and services", async () => {
    assert.equal((await call("POST", "/api/staff", "recepcja.turek", { name: "X", sites: ["turek"] })).status, 403);
    const staff = await call("POST", "/api/staff", "admin", { name: "Anna Nowak", sites: ["turek", "poddebice"] });
    assert.equal(staff.status, 201);
    const list = await call("GET", "/api/staff", "dr.kowalska");
    assert.deepEqual(list.body.find((s: { id: number }) => s.id === staff.body.id).sites, ["poddebice", "turek"]);

    const service = await call("POST", "/api/services", "admin", {
      category: "Zachowawcza",
      name: "Wypełnienie",
      durationMinutes: 45,
      priceMin: 250,
      priceMax: 400,
    });
    assert.equal(service.status, 201);
    const services = await call("GET", "/api/services", "recepcja.turek");
    assert.equal(services.body[0].durationMinutes, 45);
    assert.equal(services.body[0].priceMax, 400);
  });

  test("services: admin edits, bad price range refused, website list shows only public ones", async () => {
    const hidden = await call("POST", "/api/services", "admin", {
      category: "Zachowawcza",
      name: "Wizyta kontrolna (wewnętrzna)",
      durationMinutes: 15,
      showOnline: false,
    });
    assert.equal(hidden.status, 201);
    const filling = (await call("GET", "/api/services", "admin")).body.find((s: { name: string }) => s.name === "Wypełnienie");

    assert.equal((await call("PATCH", `/api/services/${filling.id}`, "recepcja.turek", { priceMin: 1 })).status, 403);
    assert.equal((await call("PATCH", `/api/services/${filling.id}`, "admin", { priceMin: 500 })).status, 400);
    const ok = await call("PATCH", `/api/services/${filling.id}`, "admin", {
      priceMin: 280,
      priceNote: "za ząb",
      description: "Wypełnienie kompozytowe",
    });
    assert.equal(ok.status, 200);
    const log = await db.query("SELECT changes FROM audit_log WHERE action = 'service.update'");
    assert.deepEqual(log.rows[0].changes.priceMin, { from: 250, to: 280 });

    const res = await app.inject({ method: "GET", url: "/api/public/services", headers: { origin: "https://dentaplus.pl" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["access-control-allow-origin"], "https://dentaplus.pl");
    const body = res.json();
    assert.equal(body.currency, "PLN");
    const names = body.categories.flatMap((c: { services: { name: string }[] }) => c.services.map((s) => s.name));
    assert.ok(names.includes("Wypełnienie"));
    assert.ok(!names.includes("Wizyta kontrolna (wewnętrzna)"));
    const other = await app.inject({ method: "GET", url: "/api/public/services", headers: { origin: "https://evil.example" } });
    assert.equal(other.headers["access-control-allow-origin"], undefined);

    await call("PATCH", `/api/services/${hidden.body.id}`, "admin", { active: false });
    assert.ok(!(await call("GET", "/api/services", "admin")).body.some((s: { id: number }) => s.id === hidden.body.id));
    assert.ok((await call("GET", "/api/services?all=true", "admin")).body.some((s: { id: number }) => s.id === hidden.body.id));
  });

  test("patients: phone normalised, search by name and phone, doctor cannot write", async () => {
    const created = await call("POST", "/api/patients", "recepcja.turek", {
      firstName: "Jan",
      lastName: "Testowy",
      phone: "600 100 200",
      medicalFlags: ["cukrzyca"],
      smsConsent: true,
    });
    assert.equal(created.status, 201);
    assert.equal((await call("POST", "/api/patients", "dr.kowalska", { firstName: "A", lastName: "B" })).status, 403);
    assert.equal(
      (await call("POST", "/api/patients", "recepcja.turek", { firstName: "A", lastName: "B", phone: "12" })).status,
      400,
    );

    const byPhone = await call("GET", "/api/patients?q=%2B48600100200", "dr.kowalska");
    assert.equal(byPhone.body.length, 1);
    assert.equal(byPhone.body[0].phone, "+48600100200");
    const byName = await call("GET", "/api/patients?q=testowy", "recepcja.turek");
    assert.equal(byName.body[0].id, created.body.id);
    // Search results carry no medical content; the full card does.
    assert.equal(byName.body[0].medicalFlags, undefined);
    assert.equal(byName.body[0].notes, undefined);

    const patched = await call("PATCH", `/api/patients/${created.body.id}`, "recepcja.turek", { notes: "alergia" });
    assert.equal(patched.status, 200);
    const log = await db.query("SELECT changes FROM audit_log WHERE action = 'patient.update'");
    assert.deepEqual(log.rows[0].changes, { fields: ["notes"] });

    const withBirthDate = await call("POST", "/api/patients", "recepcja.turek", {
      firstName: "Ewa",
      lastName: "Datowa",
      birthDate: "1985-03-10",
    });
    const dated = await call("GET", `/api/patients/${withBirthDate.body.id}`, "recepcja.turek");
    assert.equal(dated.body.birthDate, "1985-03-10");

    const unknownOnly = await call("PATCH", `/api/patients/${created.body.id}`, "recepcja.turek", { shoeSize: 42 });
    assert.equal(unknownOnly.status, 400);
  });

  test("appointments: duration from service, overlap blocked, cancel frees the slot, move keeps length", async () => {
    const staffId = (await call("GET", "/api/staff", "admin")).body[0].id;
    const serviceId = (await call("GET", "/api/services", "admin")).body[0].id;
    const patientId = (await call("GET", "/api/patients?q=testowy", "admin")).body[0].id;

    await call("POST", "/api/schedules", "recepcja.turek", {
      staffId,
      siteId: "turek",
      startsAt: "2026-12-01T07:00:00Z",
      endsAt: "2026-12-01T15:00:00Z",
    });

    const first = await call("POST", "/api/appointments", "recepcja.turek", {
      siteId: "turek",
      staffId,
      patientId,
      serviceId,
      startsAt: "2026-12-01T08:00:00Z",
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.endsAt, "2026-12-01T08:45:00.000Z");
    assert.deepEqual(first.body.warnings, []);

    const clash = await call("POST", "/api/appointments", "recepcja.turek", {
      siteId: "turek",
      staffId,
      patientId,
      startsAt: "2026-12-01T08:30:00Z",
      endsAt: "2026-12-01T09:00:00Z",
    });
    assert.equal(clash.status, 409);

    const late = await call("POST", "/api/appointments", "recepcja.turek", {
      siteId: "turek",
      staffId,
      title: "Usługa spoza cennika",
      startsAt: "2026-12-01T16:00:00Z",
      endsAt: "2026-12-01T16:30:00Z",
    });
    assert.equal(late.status, 201);
    assert.deepEqual(late.body.warnings, ["Poza godzinami pracy z grafiku."]);

    assert.equal(
      (await call("PATCH", `/api/appointments/${first.body.id}`, "recepcja.turek", { status: "cancelled" })).status,
      200,
    );
    const reuse = await call("POST", "/api/appointments", "recepcja.turek", {
      siteId: "turek",
      staffId,
      patientId,
      startsAt: "2026-12-01T08:30:00Z",
      endsAt: "2026-12-01T09:00:00Z",
    });
    assert.equal(reuse.status, 201);

    const moved = await call("PATCH", `/api/appointments/${reuse.body.id}`, "recepcja.turek", {
      startsAt: "2026-12-01T10:00:00Z",
    });
    assert.equal(moved.body.endsAt, "2026-12-01T10:30:00.000Z");

    const day = await call(
      "GET",
      "/api/appointments?site=turek&from=2026-12-01T00:00:00Z&to=2026-12-02T00:00:00Z",
      "dr.kowalska",
    );
    assert.equal(day.status, 200);
    assert.equal(day.body.length, 3);
    assert.equal(day.body.find((a: { id: number }) => a.id === reuse.body.id).patientName, "Jan Testowy");

    const card = await call("GET", `/api/patients/${patientId}`, "dr.kowalska");
    assert.equal(card.body.appointments.length, 2);
    assert.deepEqual(card.body.medicalFlags, ["cukrzyca"]);
  });

  test("patient history: edits, card views and visit changes, admin only", async () => {
    const patientId = (await call("GET", "/api/patients?q=testowy", "admin")).body[0].id;
    assert.equal((await call("GET", `/api/patients/${patientId}/history`, "recepcja.turek")).status, 403);
    const history = await call("GET", `/api/patients/${patientId}/history`, "admin");
    assert.equal(history.status, 200);
    const actions = history.body.map((e: { action: string }) => e.action);
    for (const action of ["patient.create", "patient.update", "patient.view", "appointment.create", "appointment.update"]) {
      assert.ok(actions.includes(action), action);
    }
    const view = history.body.find((e: { action: string }) => e.action === "patient.view");
    assert.equal(view.userName, "Dr Kowalska");
  });

  test("failed logins are limited and logged", async () => {
    const limited = buildApp(db, { loginLimiter: createLoginLimiter({ maxPerLogin: 2 }) });
    const attempt = (password: string) =>
      limited.inject({ method: "POST", url: "/api/auth/login", payload: { login: "admin", password } });
    assert.equal((await attempt("wrong-1")).statusCode, 401);
    assert.equal((await attempt("wrong-2")).statusCode, 401);
    const blocked = await attempt(PASSWORD);
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers["retry-after"]) > 0);
    const failed = await db.query("SELECT entity_id FROM audit_log WHERE action = 'auth.failed'");
    assert.ok(failed.rows.some((r) => r.entity_id === "admin"));
    await limited.close();
  });
});

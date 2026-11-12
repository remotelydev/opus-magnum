import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createUser } from "./auth.js";
import type { Db } from "./db.js";
import { KIOSK_HOURLY_LIMIT } from "./intake.js";
import { createLoginLimiter } from "./login-limit.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";

const PASSWORD = "correct-horse-battery";
const ANSWERS = {
  firstName: "Anna",
  lastName: "Nowak",
  birthDate: "1985-03-02",
  phone: "600 100 200",
  conditions: ["hypertension"],
  allergies: "tak",
  allergyDetails: "penicylina",
  anesthesia: "nie",
  pregnancy: "nie",
  privacy: true,
  truthful: true,
  smsConsent: true,
};

describe("patient registration on the iPad", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: Db;
  let app: FastifyInstance;
  let desk = "";
  let doctor = "";
  let kiosk = "";

  async function call(method: string, url: string, auth: { bearer?: string; kiosk?: string }, payload?: unknown) {
    const headers: Record<string, string> = {};
    if (auth.bearer) headers.authorization = `Bearer ${auth.bearer}`;
    if (auth.kiosk) headers.cookie = `kiosk=${auth.kiosk}`;
    const res = await app.inject({ method: method as "GET", url, payload: payload as object, headers });
    return { status: res.statusCode, body: res.body ? res.json() : null, cookie: res.headers["set-cookie"] as string | undefined };
  }

  before(async () => {
    db = await freshDb();
    app = buildApp(db, { loginLimiter: createLoginLimiter({ maxPerLogin: 1000, maxPerAddress: 1000 }) });
    await createUser(db, { login: "recepcja", name: "Recepcja", role: "reception", password: PASSWORD });
    await createUser(db, { login: "dr.nowak", name: "Dr Nowak", role: "doctor", password: PASSWORD });
    desk = (await call("POST", "/api/auth/login", {}, { login: "recepcja", password: PASSWORD })).body.token;
    doctor = (await call("POST", "/api/auth/login", {}, { login: "dr.nowak", password: PASSWORD })).body.token;
  });

  after(async () => {
    await app.close();
    await db.end();
  });

  test("an unpaired tablet gets no form", async () => {
    const state = (await call("GET", "/api/kiosk/state", {})).body;
    assert.equal(state.paired, false);
    assert.equal(state.form, undefined);
    assert.deepEqual(state.sites.map((s: { id: string }) => s.id), ["poddebice", "turek"]);
    assert.equal((await call("GET", "/api/kiosk/state", { kiosk: "made-up" })).body.paired, false);
    assert.equal((await call("POST", "/api/kiosk/submissions", {}, { answers: ANSWERS })).status, 401);
  });

  test("pairing needs a reception or admin password and sets a narrow HttpOnly cookie", async () => {
    const pair = { siteId: "turek", name: "iPad poczekalnia" };
    assert.equal((await call("POST", "/api/kiosk/pair", {}, { ...pair, login: "recepcja", password: "wrong" })).status, 401);
    assert.equal((await call("POST", "/api/kiosk/pair", {}, { ...pair, login: "dr.nowak", password: PASSWORD })).status, 403);
    const res = await call("POST", "/api/kiosk/pair", {}, { ...pair, login: "recepcja", password: PASSWORD });
    assert.equal(res.status, 201);
    assert.match(res.cookie!, /^kiosk=[\w-]{40,}; HttpOnly; SameSite=Strict; Path=\/api\/kiosk; Max-Age=\d+$/);
    kiosk = res.cookie!.split(";")[0].slice("kiosk=".length);
    const state = await call("GET", "/api/kiosk/state", { kiosk });
    assert.equal(state.body.paired, true);
    assert.equal(state.body.device.siteName, "Turek");
    assert.ok(state.body.form.steps.length >= 2);
  });

  test("the tablet token opens nothing else", async () => {
    assert.equal((await call("GET", "/api/patients?q=a", { kiosk })).status, 401);
    assert.equal((await call("GET", "/api/intake", { kiosk })).status, 401);
    assert.equal((await call("GET", "/api/me", { kiosk })).status, 401);
  });

  test("the tablet sends answers and gets nothing back", async () => {
    const bad = await call("POST", "/api/kiosk/submissions", { kiosk }, { answers: { ...ANSWERS, phone: "12" } });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fields.phone);
    const ok = await call("POST", "/api/kiosk/submissions", { kiosk }, { answers: ANSWERS });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body, { ok: true });
  });

  test("reception sees the registration and creates a card from it", async () => {
    assert.equal((await call("GET", "/api/intake", { bearer: doctor })).status, 403);
    const list = await call("GET", "/api/intake", { bearer: desk });
    assert.equal(list.body.length, 1);
    const item = list.body[0];
    assert.equal(item.phone, "+48600100200");
    assert.equal(item.deviceName, "iPad poczekalnia");
    const detail = await call("GET", `/api/intake/${item.id}`, { bearer: desk });
    assert.equal(detail.body.answers.allergyDetails, "penicylina");
    assert.deepEqual(detail.body.draft.medicalFlags, ["Nadciśnienie", "Alergia"]);
    assert.deepEqual(detail.body.matches, []);

    const accepted = await call("POST", `/api/intake/${item.id}/accept`, { bearer: desk }, {});
    assert.equal(accepted.status, 200);
    const card = await call("GET", `/api/patients/${accepted.body.patientId}`, { bearer: desk });
    assert.equal(card.body.lastName, "Nowak");
    assert.equal(card.body.smsConsent, true);
    assert.deepEqual(card.body.medicalFlags, ["Nadciśnienie", "Alergia"]);
    assert.match(card.body.notes, /^Ankieta z .*: Alergie: penicylina$/);
    assert.equal((await call("POST", `/api/intake/${item.id}/accept`, { bearer: desk }, {})).status, 404);
    assert.equal((await call("GET", "/api/intake", { bearer: desk })).body.length, 0);
    assert.equal((await call("GET", "/api/intake?status=accepted", { bearer: desk })).body.length, 1);
  });

  test("a returning patient's registration is attached to their card without overwriting it", async () => {
    const { body: created } = await call("POST", "/api/patients", { bearer: desk }, {
      firstName: "Jan",
      lastName: "Kowalski",
      phone: "+48500600700",
      email: "jan@stary.pl",
      medicalFlags: ["Cukrzyca"],
      notes: "Woli rano.",
    });
    await call("POST", "/api/kiosk/submissions", { kiosk }, {
      answers: { ...ANSWERS, firstName: "Jan", lastName: "Kowalski", phone: "500600700", email: "jan@nowy.pl", allergies: "nie" },
    });
    const [item] = (await call("GET", "/api/intake", { bearer: desk })).body;
    const detail = await call("GET", `/api/intake/${item.id}`, { bearer: desk });
    assert.deepEqual(detail.body.matches.map((m: { id: number }) => m.id), [created.id]);
    const res = await call("POST", `/api/intake/${item.id}/accept`, { bearer: desk }, { patientId: created.id });
    assert.equal(res.body.patientId, created.id);
    const card = (await call("GET", `/api/patients/${created.id}`, { bearer: desk })).body;
    assert.equal(card.email, "jan@stary.pl");
    assert.equal(card.birthDate, "1985-03-02");
    assert.deepEqual([...card.medicalFlags].sort(), ["Cukrzyca", "Nadciśnienie"]);
    assert.equal(card.notes, "Woli rano.");
  });

  test("reception can delete a test entry", async () => {
    await call("POST", "/api/kiosk/submissions", { kiosk }, { answers: ANSWERS });
    const [item] = (await call("GET", "/api/intake", { bearer: desk })).body;
    assert.equal((await call("DELETE", `/api/intake/${item.id}`, { bearer: desk })).status, 200);
    assert.equal((await call("GET", `/api/intake/${item.id}`, { bearer: desk })).status, 404);
  });

  test("a flood from one tablet is stopped", async () => {
    const device = (await db.query("SELECT id FROM kiosk_devices LIMIT 1")).rows[0].id;
    await db.query(
      `INSERT INTO intake_submissions (device_id, site_id, form_version, first_name, last_name, answers)
       SELECT $1, 'turek', 'x', 'X', 'Y', '{}' FROM generate_series(1, $2)`,
      [device, KIOSK_HOURLY_LIMIT],
    );
    assert.equal((await call("POST", "/api/kiosk/submissions", { kiosk }, { answers: ANSWERS })).status, 429);
    await db.query("DELETE FROM intake_submissions WHERE form_version = 'x'");
  });

  test("a revoked tablet stops working at once", async () => {
    const devices = (await call("GET", "/api/kiosk-devices", { bearer: desk })).body;
    assert.equal(devices.length, 1);
    assert.ok(devices[0].lastSeenAt);
    assert.equal((await call("DELETE", `/api/kiosk-devices/${devices[0].id}`, { bearer: desk })).status, 200);
    assert.equal((await call("GET", "/api/kiosk/state", { kiosk })).body.paired, false);
    assert.equal((await call("POST", "/api/kiosk/submissions", { kiosk }, { answers: ANSWERS })).status, 401);
  });

  test("staff can switch a tablet back from the tablet itself", async () => {
    const res = await call("POST", "/api/kiosk/pair", {}, { siteId: "poddebice", name: "iPad 2", login: "recepcja", password: PASSWORD });
    const token = res.cookie!.split(";")[0].slice("kiosk=".length);
    assert.equal((await call("POST", "/api/kiosk/unpair", { kiosk: token }, { login: "recepcja", password: "zle" })).status, 401);
    const off = await call("POST", "/api/kiosk/unpair", { kiosk: token }, { login: "recepcja", password: PASSWORD });
    assert.equal(off.status, 200);
    assert.match(off.cookie!, /Max-Age=0/);
    assert.equal((await call("GET", "/api/kiosk/state", { kiosk: token })).body.paired, false);
  });
});

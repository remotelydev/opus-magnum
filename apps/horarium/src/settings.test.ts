import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createUser } from "./auth.js";
import type { Db } from "./db.js";
import { overlappingDay } from "./settings.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";

const PASSWORD = "correct-horse-battery";

test("overlappingDay finds two ranges that clash on one weekday", () => {
  assert.equal(
    overlappingDay([
      { weekday: 1, siteId: "turek", starts: "08:00", ends: "12:00" },
      { weekday: 1, siteId: "poddebice", starts: "13:00", ends: "18:00" },
      { weekday: 2, siteId: "turek", starts: "08:00", ends: "16:00" },
    ]),
    null,
  );
  assert.equal(
    overlappingDay([
      { weekday: 3, siteId: "turek", starts: "08:00", ends: "12:30" },
      { weekday: 3, siteId: "poddebice", starts: "12:00", ends: "18:00" },
    ]),
    3,
  );
});

describe("settings API", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
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
    await createUser(db, { login: "recepcja", name: "Recepcja", role: "reception", password: PASSWORD });
    await createUser(db, { login: "lekarz", name: "Lekarz", role: "doctor", password: PASSWORD });
    for (const login of ["admin", "recepcja", "lekarz"]) {
      tokens[login] = (await call("POST", "/api/auth/login", null, { login, password: PASSWORD })).body.token;
    }
  });

  after(async () => {
    await app.close();
    await db.end();
  });

  test("staff: admin adds and edits details and sites, others cannot", async () => {
    const created = await call("POST", "/api/staff", "admin", {
      name: " Anna Nowak ",
      title: "lekarz dentysta",
      phone: "600 100 200",
      sites: ["turek"],
    });
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal((await call("PATCH", `/api/staff/${id}`, "recepcja", { active: false })).status, 403);
    assert.equal(
      (await call("PATCH", `/api/staff/${id}`, "admin", { sites: ["turek", "poddebice"], email: "", sortOrder: 2 })).status,
      200,
    );
    const anna = (await call("GET", "/api/staff", "lekarz")).body.find((s: { id: number }) => s.id === id);
    assert.equal(anna.name, "Anna Nowak");
    assert.equal(anna.title, "lekarz dentysta");
    assert.equal(anna.email, null);
    assert.equal(anna.sortOrder, 2);
    assert.deepEqual(anna.sites, ["poddebice", "turek"]);
    // A new person gets a palette colour; admins can change it, and only to a hex colour.
    assert.match(anna.color, /^#[0-9a-f]{6}$/);
    assert.equal((await call("PATCH", `/api/staff/${id}`, "admin", { color: "#AABBCC" })).status, 200);
    assert.equal((await call("PATCH", `/api/staff/${id}`, "admin", { color: "red" })).status, 400);
    const recoloured = (await call("GET", "/api/staff", "lekarz")).body.find((s: { id: number }) => s.id === id);
    assert.equal(recoloured.color, "#aabbcc");
    assert.equal((await call("PATCH", "/api/staff/99999", "admin", { active: false })).status, 404);
  });

  test("opening hours: admin sets the week and holidays, public endpoint applies them", async () => {
    const week = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: "08:00", closes: weekday === 5 ? "16:00" : "20:00" }));
    assert.equal((await call("PUT", "/api/opening-hours/turek", "recepcja", { week })).status, 403);
    assert.equal(
      (await call("PUT", "/api/opening-hours/turek", "admin", { week: [{ weekday: 1, opens: "18:00", closes: "08:00" }] })).status,
      400,
    );
    assert.equal((await call("PUT", "/api/opening-hours/turek", "admin", { week })).status, 200);
    assert.equal((await call("PUT", "/api/opening-hours/nigdzie", "admin", { week })).status, 404);
    // 2030-12-24 is a Tuesday: closed. 2030-12-31 (Tuesday): shorter day.
    assert.equal(
      (await call("PUT", "/api/opening-hours/turek/exceptions/2030-12-24", "admin", { opens: null, closes: null, note: "Wigilia" })).status,
      200,
    );
    assert.equal(
      (await call("PUT", "/api/opening-hours/turek/exceptions/2030-12-31", "admin", { opens: "08:00", closes: "13:00" })).status,
      200,
    );
    assert.equal(
      (await call("PUT", "/api/opening-hours/turek/exceptions/2030-12-30", "admin", { opens: "08:00", closes: null })).status,
      400,
    );

    const settings = await call("GET", "/api/opening-hours", "lekarz");
    const turek = settings.body.sites.find((s: { id: string }) => s.id === "turek");
    assert.equal(turek.week.length, 5);
    assert.deepEqual(turek.week[4], { weekday: 5, opens: "08:00", closes: "16:00" });

    const pub = await app.inject({
      method: "GET",
      url: "/api/public/opening-hours?from=2030-12-23&days=9",
      headers: { origin: "https://dentaplus.pl" },
    });
    assert.equal(pub.statusCode, 200);
    assert.equal(pub.headers["access-control-allow-origin"], "https://dentaplus.pl");
    const site = pub.json().sites.find((s: { id: string }) => s.id === "turek");
    assert.equal(site.week[0].weekday, "poniedziałek");
    assert.equal(site.week[6].open, false);
    const byDate = Object.fromEntries(site.days.map((d: { date: string }) => [d.date, d]));
    assert.deepEqual(byDate["2030-12-23"], { date: "2030-12-23", weekday: "poniedziałek", open: true, opens: "08:00", closes: "20:00", note: null });
    assert.equal(byDate["2030-12-24"].open, false);
    assert.equal(byDate["2030-12-24"].note, "Wigilia");
    assert.equal(byDate["2030-12-28"].open, false); // Saturday
    assert.equal(byDate["2030-12-31"].closes, "13:00");
    assert.equal(site.days.length, 9);

    assert.equal((await call("DELETE", "/api/opening-hours/turek/exceptions/2030-12-31", "admin")).status, 200);
    assert.equal((await call("DELETE", "/api/opening-hours/turek/exceptions/2030-12-31", "admin")).status, 404);
  });

  test("schedule: pattern saved, generated into working hours, holidays skipped, absences kept", async () => {
    const id = (await call("POST", "/api/staff", "admin", { name: "Piotr Grafik", sites: ["turek", "poddebice"] })).body.id;
    assert.equal(
      (
        await call("PUT", `/api/staff/${id}/pattern`, "recepcja", {
          days: [
            { weekday: 1, siteId: "turek", starts: "08:00", ends: "12:00" },
            { weekday: 1, siteId: "poddebice", starts: "11:00", ends: "15:00" },
          ],
        })
      ).status,
      400,
    );
    const days = [
      { weekday: 1, siteId: "turek", starts: "08:00", ends: "12:00" },
      { weekday: 1, siteId: "poddebice", starts: "13:00", ends: "18:00" },
      { weekday: 2, siteId: "turek", starts: "09:00", ends: "17:00" },
    ];
    assert.equal((await call("PUT", `/api/staff/${id}/pattern`, "lekarz", { days })).status, 403);
    assert.equal((await call("PUT", `/api/staff/${id}/pattern`, "recepcja", { days })).status, 200);
    assert.deepEqual((await call("GET", `/api/staff/${id}/pattern`, "lekarz")).body, days);

    // Absence on Monday 2030-12-16 must survive regenerating.
    const absence = await call("POST", "/api/schedules", "recepcja", {
      staffId: id,
      siteId: "turek",
      startsAt: "2030-12-15T23:00:00.000Z",
      endsAt: "2030-12-16T23:00:00.000Z",
      kind: "absence",
    });
    assert.equal(absence.status, 201);

    // Two weeks: Mon 16 Dec .. Sun 29 Dec 2030. Tuesday 24th is closed in Turek (previous test).
    const first = await call("POST", `/api/staff/${id}/schedule/generate`, "recepcja", { from: "2030-12-16", to: "2030-12-29" });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { created: 5, removed: 0, skippedClosed: 1 });
    const again = await call("POST", `/api/staff/${id}/schedule/generate`, "recepcja", { from: "2030-12-16", to: "2030-12-29" });
    assert.deepEqual(again.body, { created: 5, removed: 5, skippedClosed: 1 });

    const blocks = (await call("GET", `/api/staff/${id}/schedules?from=2030-12-16&to=2030-12-17`, "lekarz")).body;
    assert.deepEqual(
      blocks.map((b: { kind: string; siteId: string; startsAt: string }) => [b.kind, b.siteId, b.startsAt]),
      [
        ["absence", "turek", "2030-12-15T23:00:00.000Z"],
        ["work", "turek", "2030-12-16T07:00:00.000Z"],
        ["work", "poddebice", "2030-12-16T12:00:00.000Z"],
        ["work", "turek", "2030-12-17T08:00:00.000Z"],
      ],
    );

    // Public staff list: hours by day in clinic time, absence day left out, no contact data.
    const pub = (await call("GET", "/api/public/staff?from=2030-12-16&days=2", null)).body;
    const piotr = pub.staff.find((s: { id: number }) => s.id === id);
    assert.equal(piotr.phone, undefined);
    assert.deepEqual(piotr.hours, [{ date: "2030-12-17", siteId: "turek", from: "09:00", to: "17:00" }]);

    assert.equal(
      (await call("POST", `/api/staff/${id}/schedule/generate`, "recepcja", { from: "2030-12-16", to: "2030-12-01" })).status,
      400,
    );
  });
});

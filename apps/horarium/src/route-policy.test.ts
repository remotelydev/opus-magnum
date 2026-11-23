import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { audit, type Queryable } from "./db.js";
import { tmpdir } from "node:os";
import { buildApp } from "./app.js";
import { policedFastify, tagGuard } from "./route-policy.js";

const staffGuard = tagGuard("staff", async () => {});
const deviceGuard = tagGuard("device", async () => {});
const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Queryable;

function app() {
  return policedFastify({});
}

describe("route policy", () => {
  test("a route without an access level does not register", () => {
    assert.throws(() => app().get("/x", async () => ({})), /must declare config: \{ access/);
  });

  test("a staff route needs the staff guard, a device route the device guard", () => {
    const a = app();
    assert.throws(() => a.get("/x", { config: { access: "staff" } }, async () => ({})), /no staff guard/);
    assert.throws(
      () => a.get("/y", { config: { access: "device" }, preHandler: staffGuard }, async () => ({})),
      /no device guard/,
    );
    a.get("/z", { config: { access: "device" }, preHandler: deviceGuard }, async () => ({}));
  });

  test("a guarded route cannot be labelled public", () => {
    assert.throws(
      () => app().get("/x", { config: { access: "public" }, preHandler: staffGuard }, async () => ({})),
      /declare "staff" instead/,
    );
  });

  test("a route that changes data must declare its audit", () => {
    const a = app();
    assert.throws(
      () => a.post("/x", { config: { access: "staff" }, preHandler: staffGuard }, async () => ({})),
      /audited: true/,
    );
    a.post("/y", { config: { access: "public", audited: "ends a session" } }, async () => ({}));
  });

  test("an audited route that answers 2xx without an audit entry fails", async () => {
    const a = app();
    a.post("/forgot", { config: { access: "public", audited: true } }, async () => ({ ok: true }));
    a.post("/kept", { config: { access: "public", audited: true } }, async () => {
      await audit(fakeDb, null, "test.kept", "test", 1);
      return { ok: true };
    });
    assert.equal((await a.inject({ method: "POST", url: "/forgot" })).statusCode, 500);
    assert.equal((await a.inject({ method: "POST", url: "/kept" })).statusCode, 200);
  });
});

describe("UI file route", () => {
  const build = () => buildApp({ query: async () => ({ rows: [] }) } as never, { webRoot: tmpdir() });

  test("is covered by the policy like every other route", () => {
    assert.doesNotThrow(build);
  });
});

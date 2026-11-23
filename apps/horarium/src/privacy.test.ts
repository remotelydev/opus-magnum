import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, test } from "node:test";
import { buildApp } from "./app.js";
import { createUser } from "./auth.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";

describe("patient data stays out of logs", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  test("request logs keep the path and drop the query string", async () => {
    const db = await freshDb();
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = buildApp(db, { logger: true, logStream });
    await createUser(db, { login: "recepcja", name: "Recepcja", role: "reception", password: "correct-horse-battery" });
    const session = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: "recepcja", password: "correct-horse-battery" },
    });
    const token = session.json().token;
    const headers = { authorization: `Bearer ${token}` };

    await app.inject({ method: "GET", url: "/api/patients?q=Wisniewska%20600100200", headers });
    await app.inject({ method: "GET", url: "/api/patients/list?q=600100200&page=1", headers });
    await app.close();
    await db.end();

    const log = lines.join("");
    assert.match(log, /"url":"\/api\/patients"/);
    assert.match(log, /"url":"\/api\/patients\/list"/);
    assert.doesNotMatch(log, /Wisniewska|600100200/);
  });
});

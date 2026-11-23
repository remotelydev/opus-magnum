import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { createServer } from "./server.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";

describe("production composition", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  test("boots with the UI, the allowed origins and the SMS settings the way index.ts does", async () => {
    const db = await freshDb();
    const webDist = mkdtempSync(join(tmpdir(), "horarium-dist-"));
    writeFileSync(join(webDist, "index.html"), "<title>Horarium</title>");
    const app = createServer(
      db,
      { PUBLIC_ORIGINS: "https://dentaplus.pl, https://www.dentaplus.pl", TG200_HOST: "", TG200_USERNAME: "", TG200_SECRET: "" },
      webDist,
    );
    await app.ready();
    assert.equal((await app.inject({ method: "GET", url: "/" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
    const publicPrices = await app.inject({
      method: "GET",
      url: "/api/public/services",
      headers: { origin: "https://www.dentaplus.pl" },
    });
    assert.equal(publicPrices.statusCode, 200);
    assert.equal(publicPrices.headers["access-control-allow-origin"], "https://www.dentaplus.pl");
    assert.equal((await app.inject({ method: "GET", url: "/api/patients" })).statusCode, 401);
    await app.close();
    await db.end();
  });
});

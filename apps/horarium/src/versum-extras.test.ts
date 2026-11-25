import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createUser } from "./auth.js";
import type { Db } from "./db.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";
import { assetsFromZip, importVersumExtras, readStoredZip, type VersumAssetMeta } from "./versum-extras.js";
import { importVersumPatients } from "./versum-patients.js";
import { demoVersumAssets, demoVersumExtras, demoVersumPatients } from "../scripts/versum/demo-patients.js";

/** The ZIP writer of scripts/versum/extract-assets.js (the browser script), loaded as it runs there. */
async function browserZip(entries: { path: string; data: Uint8Array }[]): Promise<Buffer> {
  const window: { versumAssets?: { zip: (e: typeof entries) => Promise<Blob> } } = {};
  new Function("window", readFileSync(new URL("../scripts/versum/extract-assets.js", import.meta.url), "utf8"))(window);
  return Buffer.from(await (await window.versumAssets!.zip(entries)).arrayBuffer());
}

// Made-up records in the shape of the export.
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const manifest: VersumAssetMeta[] = [
  { patientId: "2001", assetId: "501", kind: "photo", name: "zdjęcie 1.png", type: "image/png", createdAt: "17.04.2023 13:33", description: "przed", path: "2001/501-zdjęcie 1.png" },
  { patientId: "2001", assetId: "502", kind: "file", name: "skan.html", type: "text/html", createdAt: null, description: null, path: "2001/502-skan.html" },
];
const dental = (id: number, tooth: number, over = {}) => ({
  id, tooth, surface: `${tooth}kor`, diagnosis_name: "Próchnica", treatment_name: null, employee_name: "Lekarz Testowy",
  description: "", color: "#bf2941", created_at: "2023-04-17T13:33:00.000+02:00", ...over,
});

describe("Versum extras files", () => {
  test("reads the ZIP the browser script writes, with Polish names", async () => {
    const zip = await browserZip([
      { path: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
      { path: manifest[0].path, data: PNG },
      { path: manifest[1].path, data: new TextEncoder().encode("<script>alert(1)</script>") },
    ]);
    const assets = assetsFromZip(readStoredZip(zip));
    assert.equal(assets.length, 2);
    assert.deepEqual(assets[0].data, PNG);
    assert.equal(assets[1].meta.name, "skan.html");
  });

});

describe("Versum extras import", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  before(async () => {
    db = await freshDb();
    app = buildApp(db, {});
    await createUser(db, { login: "recepcja", name: "Recepcja", role: "reception", password: "correct-horse-battery" });
    token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "recepcja", password: "correct-horse-battery" } })).json().token;
    await importVersumPatients(db, [{ id: "2001", fields: { firstname: "Ewa", lastname: "Próbna" } }]);
  });
  after(async () => {
    await app.close();
    await db.end();
  });

  test("puts dental entries and attachments on the patient's card, and a second run updates", async () => {
    const zip = await browserZip([
      { path: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
      { path: manifest[0].path, data: PNG },
      { path: manifest[1].path, data: new TextEncoder().encode("<script>alert(1)</script>") },
    ]);
    const assets = assetsFromZip(readStoredZip(zip));
    const first = await importVersumExtras(
      db,
      [{ id: "2001", dental: [dental(1, 16), dental(2, 26, { surface: "26P1", diagnosis_name: null, treatment_name: "Wypełnienie ubytku ostateczne" })] }, { id: "9999", dental: [dental(3, 11)] }],
      assets,
    );
    assert.deepEqual(first.dental, { created: 2, updated: 0 });
    assert.deepEqual(first.attachments, { created: 2, updated: 0 });
    assert.deepEqual(first.problems, [{ id: "9999", problem: "pacjent nie zaimportowany, diagram pominięty" }]);

    const again = await importVersumExtras(db, [{ id: "2001", dental: [dental(1, 16, { description: "Nowy opis" })] }], assets);
    assert.deepEqual(again.dental, { created: 0, updated: 1 });
    assert.deepEqual(again.attachments, { created: 0, updated: 2 });

    const { rows } = await db.query("SELECT entity_id FROM import_refs WHERE entity = 'patient' AND source_id = '2001'");
    const patientId = rows[0].entity_id;
    const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
    const card = (await get(`/api/patients/${patientId}`)).json();
    assert.equal(card.dentalEntries.length, 2);
    assert.equal(card.dentalEntries.find((e: { tooth: number }) => e.tooth === 16).description, "Nowy opis");
    assert.deepEqual(
      card.attachments.map((a: { kind: string; name: string }) => [a.kind, a.name]).sort(),
      [["file", "skan.html"], ["photo", "zdjęcie 1.png"]],
    );
    const photo = card.attachments.find((a: { kind: string }) => a.kind === "photo");
    assert.equal(photo.addedAt, "2023-04-17T11:33:00.000Z");

    const image = await get(`/api/patients/${patientId}/attachments/${photo.id}`);
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/png");
    assert.match(String(image.headers["content-disposition"]), /^inline; filename\*=UTF-8''zdj%C4%99cie%201\.png$/);
    assert.deepEqual(image.rawPayload, PNG);

    // An uploaded HTML file is never rendered by the browser.
    const html = card.attachments.find((a: { kind: string }) => a.kind === "file");
    const file = await get(`/api/patients/${patientId}/attachments/${html.id}`);
    assert.match(String(file.headers["content-disposition"]), /^attachment;/);
    assert.equal(file.headers["x-content-type-options"], "nosniff");

    assert.equal((await get(`/api/patients/${patientId + 1}/attachments/${photo.id}`)).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `/api/patients/${patientId}/attachments/${photo.id}` })).statusCode, 401);
    const logged = await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'patient.attachment_view'");
    assert.equal(logged.rows[0].n, 2);
  });

  test("the made-up demo extras import cleanly, with a real PNG", async () => {
    await importVersumPatients(db, demoVersumPatients());
    const result = await importVersumExtras(db, demoVersumExtras(), demoVersumAssets());
    assert.deepEqual(result.problems, []);
    assert.equal(result.dental.created, 4);
    assert.equal(result.attachments.created, 3);
    const png = demoVersumAssets()[0].data;
    assert.equal(png.subarray(1, 4).toString(), "PNG");
  });
});

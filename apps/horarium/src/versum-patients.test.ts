import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { demoVersumPatients } from "../scripts/versum/demo-patients.js";
import type { Db } from "./db.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";
import { importVersumPatients, mapVersumPatient, versumDateTime, type VersumPatientRecord } from "./versum-patients.js";

// The shape scripts/versum/extract-patients.js writes, with made-up values.
const record = (over: Partial<VersumPatientRecord["fields"]> = {}, id = "1001"): VersumPatientRecord => ({
  id,
  fields: {
    firstname: "  Anna ",
    lastname: "Testowa  Nowak",
    gender: "female",
    email: "Anna@Example.com",
    mobile: "+48600100200",
    phone_number: "600100200",
    birth_date_year: "1980",
    birth_date_month: "2",
    birth_date_day: "29",
    name_day_month: "7",
    name_day_day: "26",
    pregnancy: false,
    diabetes: true,
    anesthesia: true,
    allergies: "lateks",
    other_disease: "",
    description: "Pierwsza linia\r\nDruga linia  ",
    pesel: "800229 12345",
    card: "3465",
    street_name: "Polna",
    house_number: "3",
    unit_number: "",
    zip_code: "62-700",
    city: "Turek",
    country_iso2: "pl",
    province_id: "5",
    "customer_group_ids[]": ["11"],
    customer_origin_id: "3",
    recommendation_customer_id: "",
    send_reminder_sms: true,
    send_reminder_email: false,
    ...over,
  },
  labels: { province_id: "łódzkie", customer_origin_id: "Ulotki", "customer_group_ids[]": ["Stali pacjenci"] },
  agreements: { "37519": "notice", "37520": true },
  shown: { "Data dodania": "16.10.2019 00:00", "Ostatnia modyfikacja": "30.03.2020 09:05" },
});

describe("Versum patient mapping", () => {
  test("maps every card field", () => {
    const p = mapVersumPatient(record());
    assert.equal(p.first_name, "Anna");
    assert.equal(p.last_name, "Testowa Nowak");
    assert.equal(p.phone, "+48600100200");
    assert.equal(p.email, "anna@example.com");
    assert.equal(p.birth_date, "1980-02-29");
    assert.equal(p.name_day, "07-26");
    assert.deepEqual(p.medical_flags, ["Cukrzyca", "Podawano znieczulenie", "Alergie: lateks"]);
    assert.equal(p.description, "Pierwsza linia\nDruga linia");
    assert.equal(p.pesel, "80022912345");
    assert.equal(p.card_number, "3465");
    assert.equal(p.country, "PL");
    assert.equal(p.province, "łódzkie");
    assert.equal(p.origin, "Ulotki");
    assert.deepEqual(p.patient_groups, ["Stali pacjenci"]);
    assert.equal(p.sms_consent, true);
    assert.equal(p.email_consent, false);
    assert.equal(p.marketing_consent, true);
    assert.equal(p.gender, "female");
    assert.equal(p.unit_number, null);
    assert.equal(p.created_at, "2019-10-16 00:00");
    assert.equal(p.updated_at, "2020-03-30 09:05");
  });

  test("leaves out what Versum does not know or what is invalid", () => {
    const p = mapVersumPatient(
      record({ firstname: "", lastname: "", birth_date_year: "1981", birth_date_day: "29", gender: "", mobile: "", phone_number: "12" }),
    );
    assert.equal(p.last_name, "(brak nazwiska)");
    assert.equal(p.birth_date, null); // 29 Feb 1981 does not exist
    assert.equal(p.gender, null);
    assert.equal(p.phone, null);
    assert.equal(mapVersumPatient({ id: "1", fields: {} }).sms_consent, false);
    assert.equal(versumDateTime("nie podano"), null);
    assert.equal(versumDateTime("1.2.2003"), "2003-02-01 00:00");
  });
});

describe("Versum patient import", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: Db;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.end();
  });

  test("creates patients with import_refs, links referrals, and updates on a second run", async () => {
    const first = await importVersumPatients(db, [
      record(),
      record({ firstname: "Jan", lastname: "Polecony", recommendation_customer_id: "1001", mobile: "abc" }, "1002"),
      { id: "1003", missing: true },
    ]);
    assert.deepEqual(
      { created: first.created, updated: first.updated, skipped: first.skipped, referrals: first.referrals },
      { created: 2, updated: 0, skipped: 1, referrals: 1 },
    );
    assert.deepEqual(first.problems, [{ id: "1002", problem: "telefon nie do odczytania, zostaje tylko w import_data" }]);

    const { rows } = await db.query(
      `SELECT r.source_id, p.*, to_char(p.created_at AT TIME ZONE 'Europe/Warsaw', 'YYYY-MM-DD HH24:MI') AS added
         FROM import_refs r JOIN patients p ON p.id = r.entity_id
        WHERE r.source = 'versum' AND r.entity = 'patient' ORDER BY r.source_id`,
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].description, "Pierwsza linia\nDruga linia");
    assert.equal(rows[0].added, "2019-10-16 00:00");
    assert.equal(rows[0].import_data.fields.card, "3465");
    assert.equal(rows[1].referred_by_patient_id, rows[0].id);
    assert.equal(rows[1].phone, null);

    const second = await importVersumPatients(db, [record({ description: "Nowy opis" })]);
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    const again = await db.query(
      "SELECT (SELECT count(*)::int FROM patients) AS n, description AS d FROM patients WHERE first_name = 'Anna'",
    );
    assert.deepEqual(again.rows[0], { n: 2, d: "Nowy opis" });
    const logged = await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'patient.import'");
    assert.equal(logged.rows[0].n, 3);
  });

  test("the made-up demo export imports cleanly", async () => {
    const result = await importVersumPatients(db, demoVersumPatients());
    assert.equal(result.created, demoVersumPatients().length);
    assert.deepEqual(result.problems, []);
    assert.ok(result.referrals > 0);
  });
});

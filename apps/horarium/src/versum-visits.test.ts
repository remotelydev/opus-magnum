// Made-up records in the shape the Versum export saves (no real patient data).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Db } from "./db.js";
import { freshDb, TEST_DATABASE_URL } from "./test-db.js";
import { importVisits, normalizeVisit, splitStaffName, type ExportedVisit } from "./versum-visits.js";

const STAFF = [
  { id: 11, name: "Jan  Kowalski Turek" },
  { id: 12, name: "Jan Kowalski Poddębice" },
  { id: 13, name: "Higieny Turek" },
  { id: 14, name: "Rejestracja" },
];
const names = new Map(STAFF.map((s) => [String(s.id), s.name]));

function calendarVisit(id: number, over: Record<string, unknown> = {}): ExportedVisit {
  return {
    id: String(id),
    patient_id: "900",
    calendar: [
      {
        event_id: id,
        start: "2025-03-04T10:00:00.000+01:00",
        end: "2025-03-04T10:45:00.000+01:00",
        customer_id: 900,
        entities: [{ id: 11, type: "employee" }],
        events_services: [{ full_name: "Usługa spoza cennika", employee_ids: [11] }],
        finalized: true,
        canceled: false,
        deleted_at: null,
        description: "Wizyta planowa\n36 wyp. kompozyt",
        tags: [{ id: 137504, title: "pacjent potwierdzony", full_title: "pacjent potwierdzony" }, { id: 516714, title: "sms ", full_title: "sms " }],
        payments: [{ payment_method: "cash", payment_method_name: "gotówka", price: 400 }],
        ...over,
      },
    ],
  };
}

function deletedVisit(id: number, employee = { id: 12, name: "Jan Kowalski Poddębice" }): ExportedVisit {
  return {
    id: String(id),
    patient_id: "900",
    history_row: { cls: "basic_info dark deleted", status: "usunięto", staff: [{ id: String(employee.id), name: employee.name }] },
    screen: {
      events: [
        {
          id,
          customer_id: 900,
          beginning: "2025-03-04T10:00:00.000+01:00",
          end: "2025-03-04T11:00:00.000+01:00",
          finalized: false,
          canceled: false,
          deleted_at: "2025-03-01T09:00:00.000+01:00",
          description: null,
          tags: [],
          services: [{ name: "Usługa spoza cennika", employees: [employee] }],
          payments: [],
        },
      ],
    },
  };
}

test("splitStaffName cuts the clinic off the name", () => {
  assert.deepEqual(splitStaffName("Paweł  Nowak Turek"), { name: "Paweł Nowak", siteId: "turek" });
  assert.deepEqual(splitStaffName("Weronika Nowak  Poddębice"), { name: "Weronika Nowak", siteId: "poddebice" });
  assert.deepEqual(splitStaffName("Laura Orto Turek"), { name: "Laura Orto", siteId: "turek" });
  assert.equal(splitStaffName("Rejestracja"), null);
});

test("normalizeVisit maps Versum statuses and tags", () => {
  const done = normalizeVisit(calendarVisit(1), names)!;
  assert.equal(done.status, "done");
  assert.deepEqual(done.tags, ["sms"]);
  assert.equal(done.payments[0].amount, 400);
  assert.equal(done.staff[0].name, "Jan  Kowalski Turek");

  assert.equal(normalizeVisit(calendarVisit(2, { tags: [{ id: 521798, title: "odwołano" }] }), names)!.status, "cancelled");
  assert.equal(normalizeVisit(calendarVisit(3, { finalized: false }), names)!.status, "confirmed");
  assert.equal(normalizeVisit(calendarVisit(4, { finalized: false, tags: [] }), names)!.status, "booked");
  assert.equal(normalizeVisit(deletedVisit(5), names)!.status, "deleted");
});

describe("importVisits", { skip: !TEST_DATABASE_URL }, () => {
  let db: Db;
  before(async () => {
    db = await freshDb();
    const p = await db.query("INSERT INTO patients (first_name, last_name) VALUES ('Anna', 'Testowa') RETURNING id");
    await db.query("INSERT INTO import_refs (source, entity, source_id, entity_id) VALUES ('versum', 'patient', '900', $1)", [p.rows[0].id]);
  });
  after(async () => db?.end());

  test("imports visits once, merges a person's two Versum entries and keeps the clinic", async () => {
    const records = [
      calendarVisit(1),
      calendarVisit(2, { start: "2025-03-05T10:00:00.000+01:00", end: "2025-03-05T10:30:00.000+01:00", entities: [{ id: 12, type: "employee" }], events_services: [{ full_name: "Usługa spoza cennika", employee_ids: [12] }], tags: [{ name: "odwołano" }] }),
      deletedVisit(3), // same time as visit 1, but deleted, so it does not clash
      calendarVisit(4, { customer_id: 999 }), // patient not imported yet
      calendarVisit(5, { start: "2025-03-06T10:00:00.000+01:00", end: "2025-03-06T10:30:00.000+01:00", entities: [{ id: 14, type: "employee" }], events_services: [{ full_name: "x", employee_ids: [14] }] }),
      calendarVisit(6, { start: "2025-03-04T10:15:00.000+01:00", end: "2025-03-04T10:30:00.000+01:00" }), // clashes with 1
    ];
    const report = await importVisits(db, records, STAFF);
    assert.equal(report.inserted, 3);
    assert.equal(report.missingPatients, 1);
    assert.deepEqual(report.staffWithoutSite, { Rejestracja: 1 });
    assert.deepEqual(report.overlaps, ["6"]);
    assert.deepEqual(report.staffCreated, ["Jan Kowalski"]);

    const staff = await db.query("SELECT s.id, array_agg(ss.site_id ORDER BY ss.site_id) AS sites FROM staff s JOIN staff_sites ss ON ss.staff_id = s.id GROUP BY s.id");
    assert.equal(staff.rows.length, 1);
    assert.deepEqual(staff.rows[0].sites, ["poddebice", "turek"]);

    const rows = (
      await db.query(
        `SELECT r.source_id, a.site_id, a.status, a.treatment_notes, a.tags, a.title, a.source,
                (SELECT sum(amount)::float FROM appointment_payments WHERE appointment_id = a.id) AS paid
           FROM appointments a JOIN import_refs r ON r.entity = 'appointment' AND r.entity_id = a.id ORDER BY r.source_id`,
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => [r.source_id, r.site_id, r.status]),
      [
        ["1", "turek", "done"],
        ["2", "poddebice", "cancelled"],
        ["3", "poddebice", "deleted"],
      ],
    );
    assert.equal(rows[0].treatment_notes, "Wizyta planowa\n36 wyp. kompozyt");
    assert.deepEqual(rows[0].tags, ["sms"]);
    assert.equal(rows[0].title, "Usługa spoza cennika");
    assert.equal(rows[0].source, "import");
    assert.equal(rows[0].paid, 400);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM import_raw")).rows[0].n, 4);

    // A second run updates in place: no duplicates, payments replaced, not added.
    const again = await importVisits(db, [calendarVisit(1, { description: "poprawione" })], STAFF);
    assert.equal(again.updated, 1);
    assert.equal(again.inserted, 0);
    const one = (await db.query("SELECT a.treatment_notes, (SELECT count(*)::int FROM appointment_payments p WHERE p.appointment_id = a.id) AS n FROM appointments a JOIN import_refs r ON r.entity_id = a.id AND r.entity = 'appointment' AND r.source_id = '1'")).rows[0];
    assert.equal(one.treatment_notes, "poprawione");
    assert.equal(one.n, 1);
  });
});

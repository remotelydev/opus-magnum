import assert from "node:assert/strict";
import { test } from "node:test";
import type { Staff } from "./api.ts";
import { calendarColumns, siteColor } from "./sites.ts";
import { fromClinicTime } from "./time.ts";

const at = (date: string, hour: number) => fromClinicTime(date, hour * 60).toISOString();
const person = (id: number, sites: string[]): Staff => ({
  id,
  name: `Osoba ${id}`,
  kind: "person",
  title: null,
  phone: null,
  email: null,
  active: true,
  sortOrder: id,
  color: null,
  sites,
});
const SITES = [{ id: "turek" }, { id: "poddebice" }];
const DAY = "2026-12-01";

test("one site, or both by colour or label: one column per person", () => {
  const cols = calendarColumns(SITES, [person(1, ["turek"]), person(2, ["turek", "poddebice"])], DAY, [], [], false);
  assert.deepEqual(
    cols.map((c) => [c.key, c.siteId]),
    [
      ["1", null],
      ["2", null],
    ],
  );
});

test("both by columns: a group per clinic, a person in each clinic they work at that day", () => {
  const people = [person(1, ["turek"]), person(2, ["turek", "poddebice"]), person(3, ["turek", "poddebice"])];
  const schedules = [
    { staffId: 1, siteId: "turek", startsAt: at(DAY, 8), endsAt: at(DAY, 16), kind: "work" as const },
    // Person 2: Turek in the morning, Poddębice in the afternoon.
    { staffId: 2, siteId: "turek", startsAt: at(DAY, 8), endsAt: at(DAY, 12), kind: "work" as const },
    { staffId: 2, siteId: "poddebice", startsAt: at(DAY, 13), endsAt: at(DAY, 18), kind: "work" as const },
  ];
  // Person 3 has no hours that day but a visit in Poddębice, so only that clinic shows them.
  const appointments = [{ staffId: 3, siteId: "poddebice", startsAt: at(DAY, 10), status: "booked" as const }];
  const cols = calendarColumns(SITES, people, DAY, schedules, appointments, true);
  assert.deepEqual(
    cols.map((c) => c.key),
    ["turek:1", "turek:2", "poddebice:2", "poddebice:3"],
  );
});

test("both by columns: someone ticked with nothing that day shows in each of their clinics", () => {
  const cols = calendarColumns(SITES, [person(4, ["turek", "poddebice"])], DAY, [], [], true);
  assert.deepEqual(
    cols.map((c) => c.key),
    ["turek:4", "poddebice:4"],
  );
});

test("each clinic has its own colour", () => {
  assert.notEqual(siteColor("turek"), siteColor("poddebice"));
});

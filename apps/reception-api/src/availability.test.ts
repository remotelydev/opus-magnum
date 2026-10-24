import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentAvailabilityQuery } from "./agent.js";
import { findFreeSlots, slotLabel, type VersumCalendar } from "./availability.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const withoutAllowlist = (id: string) => {
  const location = config.locations.find((item) => item.id === id);
  assert.ok(location);
  return { ...location, versumEmployeeIds: undefined, versumHygieneCalendarIds: [9], versumNames: { "1": "Anna Trumpus" } };
};
const turek = withoutAllowlist("turek");
const poddebice = withoutAllowlist("poddebice");

const now = new Date("2026-11-02T07:00:00.000Z");

const calendar: VersumCalendar = {
  exportedAt: "2026-11-02T06:00:00.000Z",
  employees: [
    { id: 1, name: "Anna Nowak", site: "Turek", hasCalendar: true },
    { id: 2, name: "Jan Kowal", site: "Poddębice", hasCalendar: true },
    { id: 3, name: "Ewa Recepcja", site: "Turek", hasCalendar: false },
    { id: 9, name: "Higieny", site: null, hasCalendar: true },
  ],
  schedules: [
    { employeeId: 1, date: "2026-11-02", from: "2026-11-02T08:00:00.000+01:00", to: "2026-11-02T12:00:00.000+01:00", kind: "open" },
    { employeeId: 1, date: "2026-11-03", from: "2026-11-03T00:00:00.000+01:00", to: "2026-11-03T23:59:59.999+01:00", kind: "closed" },
    { employeeId: 1, date: "2026-11-04", from: "2026-11-04T14:00:00.000+01:00", to: "2026-11-04T18:00:00.000+01:00", kind: "open" },
    { employeeId: 1, date: "2026-11-11", from: "2026-11-11T08:00:00.000+01:00", to: "2026-11-11T12:00:00.000+01:00", kind: "open" },
    { employeeId: 2, date: "2026-11-02", from: "2026-11-02T08:00:00.000+01:00", to: "2026-11-02T16:00:00.000+01:00", kind: "open" },
    { employeeId: 3, date: "2026-11-02", from: "2026-11-02T08:00:00.000+01:00", to: "2026-11-02T16:00:00.000+01:00", kind: "open" },
  ],
  busy: [
    { employeeId: 9, start: "2026-11-02T10:00:00.000+01:00", end: "2026-11-02T11:00:00.000+01:00" },
    { employeeId: 1, start: "2026-11-02T10:00:00.000+01:00", end: "2026-11-02T09:45:00.000Z" },
    { employeeId: 1, start: "2026-11-04T14:00:00.000+01:00", end: "2026-11-04T14:30:00.000+01:00" },
  ],
};

describe("free slots from the Versum copy", () => {
  it("starts after the lead time and skips busy time given in mixed offsets", () => {
    const answer = findFreeSlots(calendar, turek, { durationMinutes: 30 }, config.timezone, now);
    assert.deepEqual(
      answer.slots.map((slot) => slot.start),
      ["2026-11-02T09:45:00.000Z", "2026-11-04T13:30:00.000Z"],
    );
    assert.equal(answer.slots[0].doctor, "Anna Trumpus");
    assert.equal(answer.stale, false);
  });

  it("only offers the site's own employees with a calendar", () => {
    const answer = findFreeSlots(calendar, poddebice, { durationMinutes: 30 }, config.timezone, now);
    assert.deepEqual(new Set(answer.slots.map((slot) => slot.employeeId)), new Set([2]));
  });

  it("skips public holidays even when Versum shows the doctor working", () => {
    const answer = findFreeSlots(
      calendar,
      turek,
      { durationMinutes: 30, fromDate: "2026-11-05" },
      config.timezone,
      now,
    );
    assert.deepEqual(answer.slots, []);
  });

  it("filters by part of day", () => {
    const answer = findFreeSlots(calendar, turek, { durationMinutes: 30, part: "popoludnie" }, config.timezone, now);
    assert.deepEqual(answer.slots.map((slot) => slot.label), ["środa 04.11 14:30"]);
  });

  it("uses the clinic's allowlist when it is set", () => {
    const answer = findFreeSlots(
      calendar,
      { ...turek, versumEmployeeIds: [3] },
      { durationMinutes: 30 },
      config.timezone,
      now,
    );
    assert.deepEqual(answer.slots.map((slot) => slot.employeeId), [3]);
  });

  it("offers hygiene within opening hours when the hygiene calendar has no grafik", () => {
    const answer = findFreeSlots(
      calendar,
      turek,
      { durationMinutes: 60, kind: "higienizacja", limit: 2 },
      config.timezone,
      now,
    );
    assert.deepEqual(answer.slots.map((slot) => slot.label), ["poniedziałek 02.11 11:00", "wtorek 03.11 08:00"]);
    assert.ok(answer.slots.every((slot) => slot.employeeId === 9 && slot.doctor === "higienistka"));
  });

  it("never offers dentists for hygiene or the hygiene calendar for a visit", () => {
    const visit = findFreeSlots(calendar, turek, { durationMinutes: 30, limit: 20 }, config.timezone, now);
    assert.ok(visit.slots.every((slot) => slot.employeeId !== 9));
    const noHygiene = findFreeSlots(
      calendar,
      { ...turek, versumHygieneCalendarIds: [] },
      { durationMinutes: 60, kind: "higienizacja" },
      config.timezone,
      now,
    );
    assert.deepEqual(noHygiene.slots, []);
  });

  it("marks a copy older than a day as stale", () => {
    const later = new Date("2026-11-04T07:00:00.000Z");
    assert.equal(findFreeSlots(calendar, turek, { durationMinutes: 30 }, config.timezone, later).stale, true);
  });

  it("labels slots in Warsaw time", () => {
    assert.equal(slotLabel(new Date("2026-11-04T13:30:00.000Z"), config.timezone), "środa 04.11 14:30");
  });

  it("reads only known query values from the agent", () => {
    const minutes = { wizyta: 30, higienizacja: 60 };
    assert.deepEqual(agentAvailabilityQuery({ part: "wieczor", from: "jutro", doctor: "1; drop", kind: "x" }, minutes), {
      durationMinutes: 30,
      kind: "wizyta",
      part: undefined,
      fromDate: undefined,
      employeeId: undefined,
    });
    assert.deepEqual(agentAvailabilityQuery({ part: "rano", from: "2026-11-04", doctor: "7", kind: "higienizacja" }, minutes), {
      durationMinutes: 60,
      kind: "higienizacja",
      part: "rano",
      fromDate: "2026-11-04",
      employeeId: 7,
    });
  });
});

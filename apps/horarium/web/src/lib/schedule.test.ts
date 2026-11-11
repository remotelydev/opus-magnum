import assert from "node:assert/strict";
import { test } from "node:test";
import { endOfMonthAfter, isoWeekday, mondayOf, weeklyHours } from "./schedule.ts";

test("isoWeekday and mondayOf use Monday as the first day", () => {
  assert.equal(isoWeekday("2026-11-09"), 1);
  assert.equal(isoWeekday("2026-11-15"), 7);
  assert.equal(mondayOf("2026-11-15"), "2026-11-09");
  assert.equal(mondayOf("2026-11-09"), "2026-11-09");
  assert.equal(mondayOf("2027-01-01"), "2026-12-28");
});

test("endOfMonthAfter handles year ends and short months", () => {
  assert.equal(endOfMonthAfter("2026-11-11", 0), "2026-11-30");
  assert.equal(endOfMonthAfter("2026-11-11", 3), "2027-02-28");
});

test("weeklyHours sums the ranges", () => {
  assert.equal(weeklyHours([{ starts: "08:00", ends: "16:00" }, { starts: "12:30", ends: "14:00" }]), 9.5);
});

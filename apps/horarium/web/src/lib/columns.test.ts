import assert from "node:assert/strict";
import { test } from "node:test";
import { addMonths, AUTO, formatMonth, monthGrid, parseChoice, selectedIds, staffColor, toggle, workHours, workingIds } from "./columns.ts";
import { fromClinicTime } from "./time.ts";

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return fromClinicTime(date, h! * 60 + m!).toISOString();
};
const work = (staffId: number, date: string, from: string, to: string, kind: "work" | "absence" = "work") => ({
  staffId,
  startsAt: at(date, from),
  endsAt: at(date, to),
  kind,
});

test("the month grid is six weeks from the Monday on or before the 1st", () => {
  const grid = monthGrid("2026-11");
  assert.equal(grid.length, 42);
  assert.equal(grid[0], "2026-10-26"); // 1 November 2026 is a Sunday
  assert.equal(grid[6], "2026-11-01");
  assert.equal(grid[41], "2026-12-06");
  assert.equal(monthGrid("2027-02")[0], "2027-02-01"); // starts on a Monday
});

test("months roll over the year and read like a wall calendar", () => {
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(formatMonth("2026-11"), "listopad 2026");
});

test("people working that day: a work block or a visit, but not an absence or a cancelled visit", () => {
  const ids = workingIds(
    "2026-11-12",
    [work(1, "2026-11-12", "08:00", "16:00"), work(2, "2026-11-12", "08:00", "16:00", "absence"), work(3, "2026-11-13", "08:00", "12:00")],
    [
      { staffId: 4, startsAt: at("2026-11-12", "18:30"), status: "booked" },
      { staffId: 5, startsAt: at("2026-11-12", "10:00"), status: "cancelled" },
    ],
  );
  assert.deepEqual([...ids].sort(), [1, 4]);
});

test("work hours list split shifts in order", () => {
  const hours = workHours("2026-11-12", [work(1, "2026-11-12", "13:00", "18:00"), work(1, "2026-11-12", "08:00", "12:00"), work(2, "2026-11-12", "09:30", "15:00")]);
  assert.equal(hours.get(1), "8:00–12:00, 13:00–18:00");
  assert.equal(hours.get(2), "9:30–15:00");
});

test("by default the panel ticks who works that day, and nobody on a day nobody is scheduled", () => {
  const staff = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual([...selectedIds(staff, AUTO, new Set([2]))], [2]);
  assert.deepEqual([...selectedIds(staff, AUTO, new Set())], []);
  assert.deepEqual([...selectedIds(staff, { mode: "manual", ids: [3] }, new Set([2]))], [3]);
});

test("the first tick turns the day's set into the user's own choice", () => {
  assert.deepEqual(toggle(new Set([1, 2]), 2), { mode: "manual", ids: [1] });
  assert.deepEqual(toggle(new Set([1]), 3), { mode: "manual", ids: [1, 3] });
});

test("a saved choice is read back, and anything damaged falls back to the schedule", () => {
  assert.deepEqual(parseChoice('{"mode":"manual","ids":[4,7]}'), { mode: "manual", ids: [4, 7] });
  assert.deepEqual(parseChoice('{"mode":"manual","ids":["x"]}'), AUTO);
  assert.deepEqual(parseChoice("{oops"), AUTO);
  assert.deepEqual(parseChoice(null), AUTO);
});

test("a person without a saved colour still gets a stable one", () => {
  assert.equal(staffColor({ id: 3, color: "#aabbcc" }), "#aabbcc");
  assert.equal(staffColor({ id: 3, color: null }), staffColor({ id: 3, color: null }));
});

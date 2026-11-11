import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  addDays,
  fromClinicTime,
  layoutColumn,
  parseHhmm,
  slotAt,
  toClinicTime,
  todayInClinic,
} from "./time.ts";

test("clinic time round-trips in winter and summer", () => {
  assert.equal(fromClinicTime("2026-12-01", 8 * 60).toISOString(), "2026-12-01T07:00:00.000Z");
  assert.equal(fromClinicTime("2026-07-01", 8 * 60).toISOString(), "2026-07-01T06:00:00.000Z");
  assert.deepEqual(toClinicTime("2026-12-01T07:30:00Z"), { date: "2026-12-01", minutes: 8 * 60 + 30 });
  assert.equal(todayInClinic(new Date("2026-12-01T23:30:00Z")), "2026-12-02");
});

test("DST switch days", () => {
  // 29 Mar 2026: clocks jump 02:00 -> 03:00. 10:00 local is 08:00 UTC.
  assert.equal(fromClinicTime("2026-03-29", 10 * 60).toISOString(), "2026-03-29T08:00:00.000Z");
  // 25 Oct 2026: clocks go back. 10:00 local is 09:00 UTC.
  assert.equal(fromClinicTime("2026-10-25", 10 * 60).toISOString(), "2026-10-25T09:00:00.000Z");
});

test("addDays and parseHhmm", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(parseHhmm("8:15"), 495);
  assert.equal(parseHhmm("14.30"), 870);
  assert.equal(parseHhmm("25:00"), null);
});

test("layoutColumn splits only overlapping items into lanes", () => {
  const a = { id: "a", startMin: 480, endMin: 540 };
  const b = { id: "b", startMin: 510, endMin: 570 };
  const c = { id: "c", startMin: 600, endMin: 630 };
  const out = Object.fromEntries(layoutColumn([c, b, a]).map((p) => [p.item.id, p]));
  assert.deepEqual([out.a.lane, out.a.lanes], [0, 2]);
  assert.deepEqual([out.b.lane, out.b.lanes], [1, 2]);
  assert.deepEqual([out.c.lane, out.c.lanes], [0, 1]);
  assert.equal(out.a.top, 60);
  assert.equal(out.a.height, 60);
});

test("slotAt: the hover label and the click pick the same slot start", () => {
  const px = 1.6;
  assert.equal(slotAt(0, px), DAY_START_MIN);
  // 14 minutes in is still the first quarter; 15 minutes starts the next one.
  assert.equal(slotAt(14.9 * px, px), DAY_START_MIN);
  assert.equal(slotAt(15 * px, px), DAY_START_MIN + 15);
  assert.equal(slotAt(-10, px), DAY_START_MIN);
  assert.equal(slotAt(1e6, px), DAY_END_MIN - 15);
});

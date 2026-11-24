import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, percent, presetRange, toCsv } from "./reports.ts";

test("presetRange: week from Monday, months, previous month across a new year", () => {
  assert.deepEqual(presetRange("today", "2026-11-24"), { from: "2026-11-24", to: "2026-11-24" });
  assert.deepEqual(presetRange("week", "2026-11-24"), { from: "2026-11-23", to: "2026-11-24" });
  assert.deepEqual(presetRange("week", "2026-11-29"), { from: "2026-11-23", to: "2026-11-29" });
  assert.deepEqual(presetRange("month", "2026-11-24"), { from: "2026-11-01", to: "2026-11-24" });
  assert.deepEqual(presetRange("lastMonth", "2026-03-10"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(presetRange("lastMonth", "2027-01-05"), { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(presetRange("year", "2026-11-24"), { from: "2026-01-01", to: "2026-11-24" });
});

test("formatDuration and percent read like Versum", () => {
  assert.equal(formatDuration(135), "2 h 15 min");
  assert.equal(formatDuration(120), "2 h");
  assert.equal(formatDuration(45), "45 min");
  assert.equal(percent(1, 8), "12,5%");
  assert.equal(percent(1, 0), "—");
});

test("toCsv: semicolons, decimal commas, quoted text, BOM", () => {
  assert.equal(toCsv([["Pracownik", "Utarg"], ["Kowalska; dr", 1250.5]]), '﻿Pracownik;Utarg\r\n"Kowalska; dr";1250,5\r\n');
});

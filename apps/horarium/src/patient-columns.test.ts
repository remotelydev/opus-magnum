import assert from "node:assert/strict";
import { test } from "node:test";
import { PATIENT_SUMMARY_COLUMNS } from "./app.js";

test("search and list never load notes or medical data", () => {
  assert.doesNotMatch(PATIENT_SUMMARY_COLUMNS, /notes|medical|allerg|\*/i);
});

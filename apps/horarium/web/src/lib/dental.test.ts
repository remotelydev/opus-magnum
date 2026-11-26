import assert from "node:assert/strict";
import { test } from "node:test";
import { surfaceLabel } from "./dental.ts";

test("names Versum's tooth surfaces", () => {
  assert.equal(surfaceLabel(16, "16kor"), "korona");
  assert.equal(surfaceLabel(26, "26P1"), "pow. 1");
  assert.equal(surfaceLabel(26, null), null);
});

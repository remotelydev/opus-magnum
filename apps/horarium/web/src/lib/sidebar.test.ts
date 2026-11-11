import assert from "node:assert/strict";
import { test } from "node:test";
import { initialCollapsed, NARROW_SCREEN_PX, parseCollapsed } from "./sidebar.ts";

test("parseCollapsed accepts only the two saved values", () => {
  assert.equal(parseCollapsed("collapsed"), true);
  assert.equal(parseCollapsed("expanded"), false);
  assert.equal(parseCollapsed(null), null);
  assert.equal(parseCollapsed("yes"), null);
});

test("without a saved choice the panel is open on 24-27 inch screens and collapsed on narrow ones", () => {
  assert.equal(initialCollapsed(null, 1920), false);
  assert.equal(initialCollapsed(null, 2560), false);
  assert.equal(initialCollapsed(null, NARROW_SCREEN_PX - 1), true);
});

test("a saved choice wins over screen width", () => {
  assert.equal(initialCollapsed("collapsed", 2560), true);
  assert.equal(initialCollapsed("expanded", 1024), false);
});

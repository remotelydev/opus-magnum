import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTheme, oppositeTheme, parseTheme } from "./theme.ts";

test("parseTheme accepts only light and dark", () => {
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("dark"), "dark");
  assert.equal(parseTheme(null), null);
  assert.equal(parseTheme("system"), null);
});

test("oppositeTheme flips", () => {
  assert.equal(oppositeTheme("light"), "dark");
  assert.equal(oppositeTheme("dark"), "light");
});

test("applyTheme leaves exactly one class", () => {
  const classes = new Set<string>();
  const classList = {
    toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name), on),
  } as unknown as DOMTokenList;
  applyTheme("dark", { classList });
  assert.deepEqual([...classes], ["dark"]);
  applyTheme("light", { classList });
  assert.deepEqual([...classes], ["light"]);
});

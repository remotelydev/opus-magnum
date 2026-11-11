import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTheme, nextTheme, parseTheme } from "./theme.ts";

test("parseTheme falls back to system", () => {
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("dark"), "dark");
  assert.equal(parseTheme(null), "system");
  assert.equal(parseTheme("purple"), "system");
});

test("nextTheme cycles system → light → dark → system", () => {
  assert.equal(nextTheme("system"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "system");
});

test("applyTheme sets exactly one class, or none for system", () => {
  const classes = new Set<string>();
  const classList = {
    toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name), on),
  } as unknown as DOMTokenList;
  applyTheme("dark", { classList });
  assert.deepEqual([...classes], ["dark"]);
  applyTheme("light", { classList });
  assert.deepEqual([...classes], ["light"]);
  applyTheme("system", { classList });
  assert.deepEqual([...classes], []);
});

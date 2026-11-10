import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderTokensCss } from "./render.ts";
import { color, statusToken } from "./tokens.ts";
import { STATUS_CLASSES } from "../components/status.tsx";

test("committed tokens.css matches tokens.ts", () => {
  const committed = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
  assert.equal(committed, renderTokensCss(), "run `pnpm --filter @opus-magnum/dentaplus-ui tokens`");
});

test("every appointment status has its three colour tokens and classes", () => {
  for (const status of Object.keys(STATUS_CLASSES) as (keyof typeof STATUS_CLASSES)[]) {
    const base = statusToken(status);
    for (const name of [base, `${base}-accent`, `${base}-foreground`]) {
      assert.ok(color[name], `missing token ${name}`);
      assert.ok(STATUS_CLASSES[status].includes(name), `${status} classes do not use ${name}`);
    }
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadLocalEnv } from "./env.js";

test("a later .env line overrides an earlier one, but not the real environment", () => {
  const path = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
  writeFileSync(path, "ENV_TEST_DUP=\nENV_TEST_KEEP=from-file\nENV_TEST_DUP=second\n");
  process.env.ENV_TEST_KEEP = "from-shell";
  delete process.env.ENV_TEST_DUP;
  loadLocalEnv(path);
  assert.equal(process.env.ENV_TEST_DUP, "second");
  assert.equal(process.env.ENV_TEST_KEEP, "from-shell");
  delete process.env.ENV_TEST_DUP;
  delete process.env.ENV_TEST_KEEP;
});

test("a blank value is the same as an unset variable", () => {
  const path = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
  writeFileSync(path, "ENV_TEST_BLANK=\nENV_TEST_SPACES=   \n");
  process.env.ENV_TEST_SHELL_BLANK = "";
  loadLocalEnv(path);
  assert.equal(process.env.ENV_TEST_BLANK, undefined);
  assert.equal(process.env.ENV_TEST_SPACES, undefined);
  assert.equal(process.env.ENV_TEST_SHELL_BLANK, undefined);
});

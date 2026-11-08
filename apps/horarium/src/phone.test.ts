import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePhone } from "./phone.js";

test("normalizePhone accepts common Polish formats", () => {
  for (const input of ["600100200", "600 100 200", "600-100-200", "+48 600 100 200", "48600100200", "0048600100200"]) {
    assert.equal(normalizePhone(input), "+48600100200", input);
  }
  assert.equal(normalizePhone("+4915112345678"), "+4915112345678");
});

test("normalizePhone rejects text and wrong lengths", () => {
  for (const input of ["", "Kowalski", "12345", "+4860010020", "6001002001"]) {
    assert.equal(normalizePhone(input), null, input);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney, suggestedPrice } from "./money.ts";

test("suggestedPrice: the lower end of a range, the only price, or nothing", () => {
  assert.equal(suggestedPrice({ priceMin: 250, priceMax: 400 }), 250);
  assert.equal(suggestedPrice({ priceMin: null, priceMax: 300 }), 300);
  assert.equal(suggestedPrice({ priceMin: null, priceMax: null }), 0);
});

test("formatMoney: Polish złoty", () => {
  assert.match(formatMoney(12500).replace(/\s/g, " "), /^12 500,00 zł$/);
});

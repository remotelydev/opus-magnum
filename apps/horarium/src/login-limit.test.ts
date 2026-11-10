import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoginLimiter } from "./login-limit.js";

test("login limiter blocks after repeated failures and unblocks after the window", () => {
  let t = 0;
  const limiter = createLoginLimiter({ maxPerLogin: 3, maxPerAddress: 5, windowMs: 60_000, now: () => t });
  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.retryAfter("10.0.0.6", "Admin"), 0);
    limiter.fail("10.0.0.6", "admin");
    t += 1000;
  }
  assert.equal(limiter.retryAfter("10.0.0.6", "admin"), 57);
  // Another login from the same address is still allowed until the per-address limit.
  assert.equal(limiter.retryAfter("10.0.0.6", "recepcja"), 0);
  limiter.fail("10.0.0.6", "recepcja");
  limiter.fail("10.0.0.6", "recepcja");
  assert.ok(limiter.retryAfter("10.0.0.6", "lekarz") > 0);
  // Another address is unaffected.
  assert.equal(limiter.retryAfter("192.168.1.20", "admin"), 0);
  t += 60_000;
  assert.equal(limiter.retryAfter("10.0.0.6", "admin"), 0);
});

test("a successful login clears that login's failures", () => {
  const limiter = createLoginLimiter({ maxPerLogin: 2 });
  limiter.fail("1.2.3.4", "admin");
  limiter.succeed("1.2.3.4", "admin");
  limiter.fail("1.2.3.4", "admin");
  assert.equal(limiter.retryAfter("1.2.3.4", "admin"), 0);
});

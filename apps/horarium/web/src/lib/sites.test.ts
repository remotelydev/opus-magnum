import assert from "node:assert/strict";
import { test } from "node:test";
import type { Staff } from "./api.ts";
import { calendarColumns, siteColor } from "./sites.ts";

const person = (id: number, sites: string[]): Staff => ({
  id,
  name: `Osoba ${id}`,
  kind: "person",
  title: null,
  phone: null,
  email: null,
  active: true,
  sortOrder: id,
  color: null,
  sites,
});

test("one column per ticked person, every clinic's visits in it", () => {
  const cols = calendarColumns([person(1, ["turek"]), person(2, ["turek", "poddebice"])]);
  assert.deepEqual(
    cols.map((c) => [c.key, c.siteId]),
    [
      ["1", null],
      ["2", null],
    ],
  );
});

test("each clinic has its own colour", () => {
  assert.notEqual(siteColor("turek"), siteColor("poddebice"));
});

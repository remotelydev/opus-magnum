import assert from "node:assert/strict";
import { test } from "node:test";
import { FORM } from "../../../src/intake-form.ts";
import { composeDate, firstErrorStep, formatAnswer, splitDate, stepFont } from "./kiosk.ts";

const field = (id: string) => FORM.steps.flatMap((s) => s.fields).find((f) => f.id === id)!;

test("composeDate: empty, partial, complete", () => {
  assert.equal(composeDate("", "", ""), "");
  assert.equal(composeDate("2", "3", ""), "?");
  assert.equal(composeDate("2", "3", "85"), "?");
  assert.equal(composeDate("2", "3", "1985"), "1985-03-02");
  assert.deepEqual(splitDate("1985-03-02"), { day: "2", month: "3", year: "1985" });
});

test("font size stays within the steps", () => {
  assert.equal(stepFont(0, -1), 0);
  assert.equal(stepFont(0, 1), 1);
  assert.equal(stepFont(3, 1), 3);
});

test("answers read naturally on the check screen", () => {
  assert.equal(formatAnswer(field("birthDate"), "1985-03-02"), "2 marca 1985");
  assert.equal(formatAnswer(field("phone"), "+48600100200"), "600 100 200");
  assert.equal(formatAnswer(field("conditions"), ["asthma", "diabetes"]), "Cukrzyca, Astma");
  assert.equal(formatAnswer(field("allergies"), "nie"), "Nie");
  assert.equal(formatAnswer(field("email"), undefined), "—");
});

test("firstErrorStep finds the step to go back to", () => {
  assert.equal(firstErrorStep(FORM, {}), null);
  assert.equal(firstErrorStep(FORM, { privacy: "x", allergies: "y" }), 1);
});

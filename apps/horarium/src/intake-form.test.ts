import assert from "node:assert/strict";
import { test } from "node:test";
import { FORM, peselBirthDate, realDate, toPatient, validateAnswers, validPesel, type Answers } from "./intake-form.js";

const TODAY = "2026-11-12";
const complete: Answers = {
  firstName: "  Anna ",
  lastName: "Nowak-Kowalska",
  birthDate: "1985-03-02",
  phone: "600 100 200",
  email: "Anna@Poczta.pl",
  conditions: ["hypertension", "asthma"],
  allergies: "tak",
  allergyDetails: "penicylina",
  medications: "",
  anesthesia: "nie",
  pregnancy: "nd",
  privacy: true,
  truthful: true,
  smsConsent: true,
  injected: "<script>",
};

test("PESEL check digit and birth date", () => {
  assert.equal(validPesel("44051401359"), true);
  assert.equal(validPesel("44051401358"), false);
  assert.equal(peselBirthDate("44051401359"), "1944-05-14");
  assert.equal(peselBirthDate("02270803624"), "2002-07-08");
});

test("dates must exist", () => {
  assert.equal(realDate("2024-02-29"), true);
  assert.equal(realDate("2026-02-31"), false);
  assert.equal(realDate("2026-2-3"), false);
});

test("valid answers are cleaned: trimmed, E.164 phone, unknown keys dropped", () => {
  const answers = { ...complete };
  const { values, errors } = validateAnswers(FORM, answers, { today: TODAY });
  assert.deepEqual(errors, {});
  assert.equal(values.firstName, "Anna");
  assert.equal(values.phone, "+48600100200");
  assert.equal(values.email, "anna@poczta.pl");
  assert.equal(values.injected, undefined);
  assert.equal(values.medications, undefined);
});

test("required fields, consents and formats are enforced", () => {
  const { errors } = validateAnswers(
    FORM,
    { firstName: "A", phone: "123", email: "nope", birthDate: "2030-01-01", postalCode: "62700", privacy: false },
    { today: TODAY },
  );
  assert.equal(errors.lastName, "To pole jest wymagane.");
  assert.match(errors.phone, /numer telefonu/);
  assert.match(errors.email, /e-mail/);
  assert.match(errors.birthDate, /datę/);
  assert.match(errors.postalCode, /00-000/);
  assert.equal(errors.privacy, "Ta zgoda jest wymagana.");
  assert.equal(errors.smsConsent, undefined, "optional consent");
});

test("a hidden follow-up question is neither required nor kept", () => {
  const answers = { ...complete, allergies: "nie", allergyDetails: "stale text" };
  const { values, errors } = validateAnswers(FORM, answers, { today: TODAY });
  assert.deepEqual(errors, {});
  assert.equal(values.allergyDetails, undefined);
  const missing = validateAnswers(FORM, { ...answers, allergies: "tak", allergyDetails: "" }, { today: TODAY });
  assert.equal(missing.errors.allergyDetails, "To pole jest wymagane.");
});

test("'none of the above' cannot be combined, PESEL must match the birth date", () => {
  const { errors } = validateAnswers(
    FORM,
    { ...complete, conditions: ["none", "asthma"], pesel: "44051401359" },
    { today: TODAY },
  );
  assert.match(errors.conditions, /Żadna/);
  assert.match(errors.pesel, /datą urodzenia/);
});

test("one step at a time checks only that step", () => {
  const { errors } = validateAnswers(FORM, { firstName: "Jan" }, { step: 2, today: TODAY });
  assert.deepEqual(Object.keys(errors).sort(), ["privacy", "truthful"]);
});

test("toPatient maps contact fields, medical flags and notes", () => {
  const answers = { ...complete, pregnancy: "tak", medications: "Bisocard 5 mg" };
  const { values } = validateAnswers(FORM, answers, { today: TODAY });
  const draft = toPatient(FORM, values);
  assert.equal(draft.firstName, "Anna");
  assert.equal(draft.phone, "+48600100200");
  assert.equal(draft.birthDate, "1985-03-02");
  assert.equal(draft.smsConsent, true);
  assert.deepEqual(draft.medicalFlags, ["Nadciśnienie", "Astma", "Alergia", "Ciąża"]);
  assert.deepEqual(draft.notes, ["Alergie: penicylina", "Przyjmowane leki: Bisocard 5 mg"]);
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config.js";
import { hoursSummary, isOpenAt, reply } from "./script.js";

const config = loadConfig();
const tz = config.timezone;

/** Monday 14 Sep 2026 10:00 in Europe/Warsaw (CEST). */
const mondayOpen = new Date("2026-09-14T08:00:00.000Z");
/** Saturday 12 Sep 2026 16:30 in Europe/Warsaw — after 15:00 close. */
const saturdayClosed = new Date("2026-09-12T14:30:00.000Z");
/** Sunday 13 Sep 2026 12:00 in Europe/Warsaw. */
const sundayClosed = new Date("2026-09-13T10:00:00.000Z");

describe("opening hours", () => {
  const turek = config.locations.find((item) => item.id === "turek");
  assert.ok(turek);

  it("is open Monday late morning", () => {
    assert.equal(isOpenAt(turek.hours, mondayOpen, tz), true);
  });

  it("is closed Saturday after 15:00", () => {
    assert.equal(isOpenAt(turek.hours, saturdayClosed, tz), false);
  });

  it("is closed Sunday", () => {
    assert.equal(isOpenAt(turek.hours, sundayClosed, tz), false);
  });

  it("spoken hours come from config JSON, grouped", () => {
    assert.equal(
      hoursSummary(turek.hours),
      "poniedziałek–piątek 08:00–20:00, sobota 10:00–15:00, niedziela nieczynne",
    );
  });

  it("spoken hours change when config hours change", () => {
    const tweaked = structuredClone(turek.hours);
    tweaked.monday = { open: "09:00", close: "17:00" };
    const spoken = hoursSummary(tweaked);
    assert.match(spoken, /poniedziałek 09:00–17:00/);
    assert.match(spoken, /wtorek–piątek 08:00–20:00/);
    assert.doesNotMatch(spoken, /poniedziałek–piątek 08:00–20:00/);
  });
});

describe("script fixtures", () => {
  it("pending consent only plays the recording notice and does not transcribe", () => {
    const result = reply(config, {
      locationId: "turek",
      now: mondayOpen,
      consent: "pending",
    });
    assert.match(result.lines[0] ?? "", /nagrywana/);
    assert.match(result.lines[0] ?? "", /nie zgadzam się/i);
    assert.equal(result.transcribe, false);
    assert.equal(result.action, "none");
  });

  it("opt-out still answers hours and never transcribes", () => {
    const result = reply(config, {
      locationId: "poddebice",
      now: mondayOpen,
      consent: "no",
      intent: "hours",
    });
    assert.equal(result.transcribe, false);
    assert.match(result.lines.join(" "), /Nie będę transkrybować/);
    assert.match(result.lines.join(" "), /Poddębice/);
    assert.match(result.lines.join(" "), /Krasickiego/);
    assert.equal(result.action, "none");
  });

  it("hours for Turek and Poddębice use different address and phone", () => {
    const turek = reply(config, {
      locationId: "turek",
      now: mondayOpen,
      consent: "yes",
      intent: "hours",
    });
    const poddebice = reply(config, {
      locationId: "poddebice",
      now: mondayOpen,
      consent: "yes",
      intent: "hours",
    });
    const turekHours = config.locations.find((item) => item.id === "turek");
    assert.ok(turekHours);
    assert.match(turek.lines.join(" "), /Łąkowa/);
    assert.match(turek.lines.join(" "), /690649589/);
    assert.equal(
      turek.lines.join(" ").includes(hoursSummary(turekHours.hours)),
      true,
    );
    assert.match(poddebice.lines.join(" "), /Krasickiego/);
    assert.match(poddebice.lines.join(" "), /690512141/);
    assert.notEqual(turek.lines.join(" "), poddebice.lines.join(" "));
  });

  it("booking asks for fields and does not promise a clock time", () => {
    const result = reply(config, {
      locationId: "turek",
      now: mondayOpen,
      consent: "yes",
      intent: "book",
    });
    assert.equal(result.action, "collect_booking");
    assert.match(result.lines.join(" "), /SMS/);
    assert.match(result.lines.join(" "), /Nie obiecuję konkretnej godziny/);
  });

  it("emergency while open transfers and does not diagnose", () => {
    const result = reply(config, {
      locationId: "turek",
      now: mondayOpen,
      consent: "yes",
      intent: "emergency",
    });
    assert.equal(result.action, "transfer");
    const text = result.lines.join(" ");
    assert.match(text, /Nie stawiam diagnozy/);
    assert.doesNotMatch(text, /antybiotyk|płukać|ibuprofen/i);
  });

  it("emergency while closed leaves a ticket and points to SOR", () => {
    const result = reply(config, {
      locationId: "turek",
      now: sundayClosed,
      consent: "yes",
      intent: "emergency",
    });
    assert.equal(result.action, "ticket");
    const text = result.lines.join(" ");
    assert.match(text, /SOR/);
    assert.match(text, /zgłoszenie/);
    assert.doesNotMatch(text, /łączę z recepcją/i);
  });

  it("human request while closed tickets and does not fake a transfer", () => {
    const result = reply(config, {
      locationId: "poddebice",
      now: saturdayClosed,
      consent: "yes",
      intent: "human",
    });
    assert.equal(result.action, "ticket");
    assert.match(result.lines.join(" "), /nieczynna/i);
    assert.match(result.lines.join(" "), /Nie łączę teraz z człowiekiem/);
  });

  it("angry caller while open transfers", () => {
    const result = reply(config, {
      locationId: "turek",
      now: mondayOpen,
      consent: "yes",
      intent: "book",
      angry: true,
    });
    assert.equal(result.action, "transfer");
  });
});

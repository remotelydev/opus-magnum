import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentFirstMessage,
  agentPrompt,
  agentTicketBody,
  hoursAnswer,
  isValidToolSecret,
} from "./agent.js";
import { loadConfig } from "./config.js";
import { buildDevTicket } from "./whatsapp.js";

const config = loadConfig();
const turek = config.locations.find((item) => item.id === "turek");
assert.ok(turek);

describe("agent tools", () => {
  it("only accepts the exact tool secret", () => {
    assert.equal(isValidToolSecret("s3cret", "s3cret"), true);
    assert.equal(isValidToolSecret("s3cre", "s3cret"), false);
    assert.equal(isValidToolSecret(undefined, "s3cret"), false);
  });

  it("answers closed with the next real opening on Christmas Eve", () => {
    const answer = hoursAnswer(config, turek, new Date("2026-12-24T09:00:00.000Z"));
    assert.equal(answer.openNow, false);
    assert.equal(answer.closedToday, true);
    assert.equal(answer.nextOpen, "w poniedziałek o 08:00");
  });

  it("answers open on a normal Monday morning", () => {
    const answer = hoursAnswer(config, turek, new Date("2026-09-14T08:00:00.000Z"));
    assert.equal(answer.openNow, true);
    assert.equal(answer.nextOpen, null);
  });

  it("requires name, phone and slot from the agent instead of falling back to the fixture", () => {
    assert.throws(() => agentTicketBody("turek", { phone: "+48500111222", slot: "wtorek" }), /invalid_name/);
    assert.throws(() => agentTicketBody("turek", { name: "Anna Nowak", slot: "wtorek" }), /invalid_phone/);
    assert.throws(() => agentTicketBody("turek", null), /invalid_name/);
  });

  it("says the clinic name without the plus sign", () => {
    assert.match(agentFirstMessage(turek), /tu DentaPlus Turek\./);
    assert.doesNotMatch(agentFirstMessage(turek), /DentaPlus\+/);
    assert.doesNotMatch(agentPrompt(config, turek), /DentaPlus\+/);
    assert.equal(hoursAnswer(config, turek).site, "DentaPlus Turek");
  });

  it("turns the agent's fields into a ticket without free text", () => {
    const body = agentTicketBody("turek", {
      name: "Anna Nowak",
      phone: "+48 500 111 222",
      category: "callback",
      slot: "jutro po 16",
      urgent: true,
      reason: "ból zęba",
    });
    const ticket = buildDevTicket(config, body);
    assert.equal(ticket.name, "Anna Nowak");
    assert.equal(ticket.phone, "+48500111222");
    assert.equal(ticket.category, "callback");
    assert.equal(ticket.urgent, true);
    assert.equal(ticket.returning, null);
    assert.doesNotMatch(JSON.stringify(ticket), /ból/);
  });
});

describe("agent prompt", () => {
  it("opens with the AI disclosure and keeps the script rules", () => {
    assert.match(agentFirstMessage(turek), /asystentem AI/);
    const prompt = agentPrompt(config, turek);
    assert.match(prompt, /Łąkowa/);
    assert.match(prompt, /Poddębice/);
    assert.match(prompt, /sprawdz_godziny/);
    assert.match(prompt, /Nie stawiasz diagnoz/);
    assert.match(prompt, /SOR/);
  });
});

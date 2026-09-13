import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config.js";
import {
  buildDevTicket,
  DEFAULT_GRAPH_VERSION,
  DEV_TICKET_FIXTURE,
  formatTicketMessage,
  resolveWhatsAppEnv,
  sendWhatsAppText,
  WhatsAppSendError,
} from "./whatsapp.js";

const config = loadConfig();

/** Monday 14 Sep 2026 10:00 in Europe/Warsaw (CEST). */
const mondayOpen = new Date("2026-09-14T08:00:00.000Z");
/** Sunday 13 Sep 2026 12:00 in Europe/Warsaw. */
const sundayClosed = new Date("2026-09-13T10:00:00.000Z");

describe("resolveWhatsAppEnv", () => {
  it("lists every missing Cloud API variable", () => {
    const result = resolveWhatsAppEnv({});
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.deepEqual(result.missing, [
      "WHATSAPP_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_TO",
    ]);
  });

  it("treats blank values as missing", () => {
    const result = resolveWhatsAppEnv({
      WHATSAPP_TOKEN: "  ",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_TO: "+48500111222",
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.deepEqual(result.missing, ["WHATSAPP_TOKEN"]);
  });

  it("returns token, phone number id, and destination", () => {
    const result = resolveWhatsAppEnv({
      WHATSAPP_TOKEN: "EAA.test",
      WHATSAPP_PHONE_NUMBER_ID: "106540352242922",
      WHATSAPP_TO: "+48500111222",
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.config.token, "EAA.test");
    assert.equal(result.config.phoneNumberId, "106540352242922");
    assert.equal(result.config.to, "+48500111222");
    assert.equal(result.config.graphVersion, DEFAULT_GRAPH_VERSION);
  });
});

describe("booking ticket fixture", () => {
  it("formats every locked field in Polish", () => {
    const ticket = buildDevTicket(config, {}, mondayOpen);
    assert.equal(ticket.locationId, "turek");
    assert.equal(ticket.locationName, "DentaPlus+ Turek");
    assert.equal(ticket.time, "2026-09-14 10:00");
    assert.equal(ticket.timeZone, "Europe/Warsaw");
    assert.equal(ticket.open, true);
    assert.equal(ticket.handler, "ai");
    assert.equal(ticket.transcriptOk, true);
    assert.equal(ticket.name, DEV_TICKET_FIXTURE.name);
    assert.equal(ticket.phone, DEV_TICKET_FIXTURE.phone);
    assert.equal(ticket.intent, "book");
    assert.equal(ticket.slotWish, "wtorek rano");
    assert.equal(ticket.urgency, "normal");
    assert.equal(ticket.returning, false);
    assert.equal(ticket.summary, DEV_TICKET_FIXTURE.summary);

    const text = formatTicketMessage(ticket);
    assert.match(text, /^Zgłoszenie — DentaPlus\+ Turek/m);
    assert.match(text, /Czas: 2026-09-14 10:00 \(Europe\/Warsaw\)/);
    assert.match(text, /Godziny: otwarte/);
    assert.match(text, /Obsługa: AI/);
    assert.match(text, /Transkrypcja: tak/);
    assert.match(text, /Imię i nazwisko: Jan Kowalski/);
    assert.match(text, /Telefon: \+48555111222/);
    assert.match(text, /Zamiar: wizyta/);
    assert.match(text, /Termin: wtorek rano/);
    assert.match(text, /Pilność: zwykła/);
    assert.match(text, /Pacjent: nowy/);
    assert.match(text, /Opis: Kontrola — prośba o wizytę/);
  });

  it("marks closed hours and returning patients when overridden", () => {
    const ticket = buildDevTicket(
      config,
      {
        locationId: "poddebice",
        handler: "human",
        transcriptOk: false,
        urgency: "urgent",
        intent: "emergency",
        returning: true,
        name: "Anna Nowak",
        phone: "+48600111222",
        slotWish: "jak najszybciej",
        summary: "Ból zęba",
      },
      sundayClosed,
    );
    assert.equal(ticket.open, false);
    assert.equal(ticket.locationName, "DentaPlus+ Poddębice");
    const text = formatTicketMessage(ticket);
    assert.match(text, /Godziny: nieczynne/);
    assert.match(text, /Obsługa: człowiek/);
    assert.match(text, /Transkrypcja: nie/);
    assert.match(text, /Zamiar: pilne/);
    assert.match(text, /Pilność: pilne/);
    assert.match(text, /Pacjent: powracający/);
    assert.match(text, /Anna Nowak/);
  });
});

describe("sendWhatsAppText", () => {
  it("POSTs a Cloud API text message and returns the message id", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await sendWhatsAppText({
      token: "EAA.secret",
      phoneNumberId: "106540352242922",
      to: "+48500111222",
      body: "Zgłoszenie — test",
      fetchImpl,
    });

    assert.equal(result.messageId, "wamid.test");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.url,
      `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/106540352242922/messages`,
    );
    const headers = new Headers(calls[0]?.init.headers);
    assert.equal(headers.get("authorization"), "Bearer EAA.secret");
    const payload = JSON.parse(String(calls[0]?.init.body)) as {
      messaging_product: string;
      to: string;
      type: string;
      text: { body: string };
    };
    assert.equal(payload.messaging_product, "whatsapp");
    assert.equal(payload.to, "+48500111222");
    assert.equal(payload.type, "text");
    assert.equal(payload.text.body, "Zgłoszenie — test");
  });

  it("surfaces Graph API errors without using a real token", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { message: "(#100) Invalid parameter", code: 100 },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );

    await assert.rejects(
      () =>
        sendWhatsAppText({
          token: "EAA.secret",
          phoneNumberId: "106540352242922",
          to: "+48500111222",
          body: "nope",
          fetchImpl,
        }),
      (error: unknown) => {
        assert.ok(error instanceof WhatsAppSendError);
        assert.equal(error.status, 400);
        assert.match(error.details, /Invalid parameter/);
        return true;
      },
    );
  });
});

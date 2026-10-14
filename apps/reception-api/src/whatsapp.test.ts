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
  type DevTicketBody,
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

describe("booking ticket", () => {
  it("formats the fixture as one minimal Polish line", () => {
    const ticket = buildDevTicket(config, {}, mondayOpen);
    assert.deepEqual(ticket, {
      locationId: "turek",
      site: "Turek",
      receivedAt: "14.09 10:00",
      name: DEV_TICKET_FIXTURE.name,
      phone: DEV_TICKET_FIXTURE.phone,
      category: "book",
      slot: "wtorek rano",
      urgent: false,
      returning: false,
    });
    assert.equal(
      formatTicketMessage(ticket),
      "Turek · wizyta · nowy · wtorek rano · Jan Kowalski · +48555111222 · 14.09 10:00",
    );
  });

  it("puts PILNE first and marks returning patients", () => {
    const ticket = buildDevTicket(
      config,
      {
        locationId: "poddebice",
        category: "callback",
        urgent: true,
        returning: true,
        name: "Anna Nowak",
        phone: "+48 600-111-222",
        slot: "jak najszybciej",
      },
      sundayClosed,
    );
    assert.equal(
      formatTicketMessage(ticket),
      "PILNE · Poddębice · oddzwonić · powracający · jak najszybciej · Anna Nowak · +48600111222 · 13.09 12:00",
    );
  });

  it("leaves out new/returning when the caller did not say", () => {
    const ticket = buildDevTicket(config, { returning: null }, mondayOpen);
    assert.doesNotMatch(formatTicketMessage(ticket), /nowy|powracający/);
  });

  it("never carries a free-text reason, even if one is posted", () => {
    const body = {
      summary: "Ból zęba po zabiegu",
      reason: "krwawienie",
      transcript: "pełna rozmowa",
    } as DevTicketBody;
    const ticket = buildDevTicket(config, body, mondayOpen);
    const text = formatTicketMessage(ticket);
    assert.doesNotMatch(text, /Ból|krwawienie|rozmowa/);
    assert.deepEqual(Object.keys(ticket).sort(), [
      "category",
      "locationId",
      "name",
      "phone",
      "receivedAt",
      "returning",
      "site",
      "slot",
      "urgent",
    ]);
  });

  it("rejects a category outside the closed list", () => {
    assert.throws(
      () => buildDevTicket(config, { category: "ból zęba" }, mondayOpen),
      /invalid_category/,
    );
  });

  it("rejects a bad phone, an empty name, and a long slot", () => {
    assert.throws(() => buildDevTicket(config, { phone: "abc" }, mondayOpen), /invalid_phone/);
    assert.throws(() => buildDevTicket(config, { name: "  " }, mondayOpen), /invalid_name/);
    assert.throws(
      () => buildDevTicket(config, { slot: "x".repeat(41) }, mondayOpen),
      /invalid_slot/,
    );
  });

  it("keeps the ticket on one line", () => {
    const ticket = buildDevTicket(config, { name: "Jan\nKowalski", slot: "wtorek\nrano" }, mondayOpen);
    assert.doesNotMatch(formatTicketMessage(ticket), /\n/);
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
      body: "Turek · wizyta · test",
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
    assert.equal(payload.text.body, "Turek · wizyta · test");
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

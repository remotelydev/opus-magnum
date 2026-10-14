import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "./config.js";
import { sendSms, SmsApiError } from "./smsapi.js";
import { formatConfirmationSms, parseStaffReply } from "./staff-reply.js";
import { createTicketStore, ticketLabel, type TicketRecord } from "./tickets.js";
import {
  extractTextMessages,
  handleStaffMessage,
  isValidSignature,
  verifySubscription,
  type InboundText,
} from "./webhook.js";
import { buildDevTicket, formatTicketMessage } from "./whatsapp.js";

const TZ = "Europe/Warsaw";
const NOW = new Date("2026-10-05T12:00:00Z");

describe("parseStaffReply", () => {
  it("reads date, time and the note", () => {
    const result = parseStaffReply("OK 7.10 14:30 proszę zabrać zdjęcie RTG", TZ, NOW);
    assert.deepEqual(result, {
      ok: true,
      confirmation: { date: "2026-10-07", time: "14:30", note: "proszę zabrać zdjęcie RTG" },
    });
  });

  it("accepts lower case, a dot in the time and no note", () => {
    const result = parseStaffReply("ok 7.10 9.05", TZ, NOW);
    assert.deepEqual(result, {
      ok: true,
      confirmation: { date: "2026-10-07", time: "09:05", note: null },
    });
  });

  it("rolls a past date without a year into next year", () => {
    const result = parseStaffReply("OK 3.01 10:00", TZ, NOW);
    assert.equal(result.ok && result.confirmation.date, "2027-01-03");
  });

  it("rejects bad input with a reason", () => {
    assert.deepEqual(parseStaffReply("dzięki", TZ, NOW), { ok: false, reason: "not_ok" });
    assert.deepEqual(parseStaffReply("OK 31.11 10:00", TZ, NOW), { ok: false, reason: "invalid_date" });
    assert.deepEqual(parseStaffReply("OK 7.10 25:00", TZ, NOW), { ok: false, reason: "invalid_time" });
    assert.deepEqual(parseStaffReply(`OK 7.10 10:00 ${"x".repeat(121)}`, TZ, NOW), {
      ok: false,
      reason: "note_too_long",
    });
  });
});

describe("formatConfirmationSms", () => {
  const location = { name: "DentaPlus+ Turek", phone: "+48690649589" };

  it("matches the plan sample", () => {
    assert.equal(
      formatConfirmationSms(location, { date: "2026-10-07", time: "14:30", note: null }),
      "DentaPlus+ Turek: potwierdzamy wizytę 7.10 (śr) o 14:30. W razie zmiany prosimy o telefon +48690649589.",
    );
  });

  it("adds the note as its own sentence", () => {
    assert.equal(
      formatConfirmationSms(location, { date: "2026-10-06", time: "08:00", note: "proszę zabrać zdjęcie RTG" }),
      "DentaPlus+ Turek: potwierdzamy wizytę 6.10 (wt) o 08:00. Proszę zabrać zdjęcie RTG. W razie zmiany prosimy o telefon +48690649589.",
    );
  });
});

describe("ticket numbers", () => {
  it("labels and prefixes the ticket line", () => {
    assert.equal(ticketLabel(412), "#T-0412");
    const ticket = buildDevTicket(loadConfig(), {}, NOW);
    assert.match(formatTicketMessage(ticket, 7), /^#T-0007 · Turek · wizyta/);
    assert.match(formatTicketMessage(ticket), /^Turek · wizyta/);
  });
});

describe("webhook security", () => {
  it("answers Meta's subscribe check only with the right token", () => {
    const query = { "hub.mode": "subscribe", "hub.verify_token": "s3cret", "hub.challenge": "1158201444" };
    assert.equal(verifySubscription(query, "s3cret"), "1158201444");
    assert.equal(verifySubscription(query, "other"), null);
    assert.equal(verifySubscription({ ...query, "hub.mode": "unsubscribe" }, "s3cret"), null);
  });

  it("checks X-Hub-Signature-256 against the raw body", () => {
    const body = Buffer.from('{"entry":[]}');
    const good = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    assert.equal(isValidSignature(body, good, "app-secret"), true);
    assert.equal(isValidSignature(body, good, "wrong-secret"), false);
    assert.equal(isValidSignature(Buffer.from('{"entry":[1]}'), good, "app-secret"), false);
    assert.equal(isValidSignature(body, undefined, "app-secret"), false);
  });

  it("extracts text messages and their reply context", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [{ id: "wamid.status" }],
                messages: [
                  { id: "wamid.in1", from: "48500111222", type: "text", text: { body: "OK 7.10 14:30" }, context: { id: "wamid.ticket" } },
                  { id: "wamid.in2", from: "48500111222", type: "image" },
                ],
              },
            },
          ],
        },
      ],
    };
    assert.deepEqual(extractTextMessages(payload), [
      { id: "wamid.in1", from: "48500111222", text: "OK 7.10 14:30", contextId: "wamid.ticket" },
    ]);
    assert.deepEqual(extractTextMessages(null), []);
  });
});

describe("handleStaffMessage", () => {
  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), "tickets-"));
    const store = createTicketStore({ dir });
    const number = await store.nextNumber();
    const ticket: TicketRecord = {
      number,
      messageId: "wamid.ticket",
      phone: "+48555111222",
      locationId: "turek",
      createdAt: NOW.toISOString(),
    };
    await store.save(ticket);
    const staff: string[] = [];
    const sms: Array<{ to: string; message: string }> = [];
    const deps = {
      config: loadConfig(),
      store,
      staffNumber: "+48500111222",
      replyToStaff: async (text: string) => {
        staff.push(text);
      },
      sendSms: async (to: string, message: string) => {
        sms.push({ to, message });
        return { sent: true as const, id: "sms-1" };
      },
      now: () => NOW,
    };
    return { dir, store, deps, staff, sms };
  }

  const reply = (over: Partial<InboundText> = {}): InboundText => ({
    id: "wamid.in1",
    from: "48500111222",
    text: "OK 7.10 14:30",
    contextId: "wamid.ticket",
    ...over,
  });

  it("sends the SMS, stores the confirmation and tells staff", async () => {
    const { dir, store, deps, staff, sms } = await setup();
    try {
      assert.equal(await handleStaffMessage(reply(), deps), "confirmed");
      assert.deepEqual(sms, [
        {
          to: "+48555111222",
          message:
            "DentaPlus+ Turek: potwierdzamy wizytę 7.10 (śr) o 14:30. W razie zmiany prosimy o telefon +48690649589.",
        },
      ]);
      assert.deepEqual(staff, ["#T-0001: SMS wysłany do +48555111222."]);
      const saved = await store.findByMessageId("wamid.ticket");
      assert.equal(saved?.confirmation?.date, "2026-10-07");
      assert.equal(await handleStaffMessage(reply(), deps), "duplicate");
      assert.equal(
        await handleStaffMessage(reply({ id: "wamid.in2" }), deps),
        "already_confirmed",
      );
      assert.equal(sms.length, 1);
      const file = JSON.parse(await readFile(join(dir, "tickets.json"), "utf8"));
      assert.equal(file.lastNumber, 1);
      assert.equal("name" in file.tickets[0], false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores other senders and explains wrong replies", async () => {
    const { dir, deps, staff, sms } = await setup();
    try {
      assert.equal(await handleStaffMessage(reply({ from: "48999000111" }), deps), "ignored_sender");
      assert.equal(await handleStaffMessage(reply({ contextId: null }), deps), "no_ticket");
      assert.equal(await handleStaffMessage(reply({ text: "OK 7.10" }), deps), "parse_error");
      assert.equal(sms.length, 0);
      assert.equal(staff.length, 2);
      assert.match(staff[1] ?? "", /^#T-0001: Nie rozumiem/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves the ticket open when SMSAPI fails, so staff can retry", async () => {
    const { dir, store, deps, staff } = await setup();
    try {
      const failing = {
        ...deps,
        sendSms: async () => {
          throw new SmsApiError("101", "Authorization failed");
        },
        onError: () => undefined,
      };
      assert.equal(await handleStaffMessage(reply(), failing), "sms_failed");
      assert.match(staff[0] ?? "", /błąd SMSAPI/);
      assert.equal((await store.findByMessageId("wamid.ticket"))?.confirmation, undefined);
      assert.equal(await handleStaffMessage(reply(), deps), "confirmed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("sendSms", () => {
  it("only logs without a token", async () => {
    const logs: string[] = [];
    const result = await sendSms({ env: null, to: "+48555111222", message: "test", log: (l) => logs.push(l) });
    assert.deepEqual(result, { sent: false, reason: "no_token" });
    assert.match(logs[0] ?? "", /SMSAPI_TOKEN missing/);
  });

  it("POSTs to SMSAPI and returns the id", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ count: 1, list: [{ id: "abc", status: "QUEUE" }] }));
    };
    const result = await sendSms({
      env: { token: "tok", sender: "DentaPlus" },
      to: "+48555111222",
      message: "wizyta",
      log: () => undefined,
      fetchImpl,
    });
    assert.deepEqual(result, { sent: true, id: "abc" });
    assert.equal(seen?.url, "https://api.smsapi.pl/sms.do");
    assert.equal(new Headers(seen?.init.headers).get("authorization"), "Bearer tok");
    const form = new URLSearchParams(String(seen?.init.body));
    assert.equal(form.get("to"), "48555111222");
    assert.equal(form.get("from"), "DentaPlus");
    assert.equal(form.get("format"), "json");
  });

  it("throws on an SMSAPI error body", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 101, message: "Authorization failed" }));
    await assert.rejects(
      () => sendSms({ env: { token: "bad", sender: undefined }, to: "48555111222", message: "x", log: () => undefined, fetchImpl }),
      (error: unknown) => error instanceof SmsApiError && error.code === "101",
    );
  });
});

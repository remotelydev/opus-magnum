import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "./config.js";
import { SmsApiError } from "./smsapi.js";
import { createTicketStore } from "./tickets.js";
import { handleStaffMessage, type InboundText } from "./webhook.js";

const NOW = new Date("2026-10-05T12:00:00Z");
const config = loadConfig();

const delivery = (id: string): InboundText => ({
  id,
  from: "48500111222",
  text: "OK 7.10 14:30",
  contextId: "wamid.ticket",
});

const DELIVERIES = ["A", "A", "B"] as const;

function sequences(length: number): string[][] {
  if (length === 0) return [[]];
  return sequences(length - 1).flatMap((rest) => DELIVERIES.map((id) => [id, ...rest]));
}

async function run(ids: string[], firstSmsFails: boolean, concurrent: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "tickets-model-"));
  try {
    const store = createTicketStore({ dir, now: () => NOW });
    const number = await store.nextNumber();
    await store.save({ number, messageId: "wamid.ticket", phone: "+48555111222", locationId: "turek", createdAt: NOW.toISOString() });
    let attempts = 0;
    let delivered = 0;
    const deps = {
      config,
      store,
      staffNumber: "+48500111222",
      replyToStaff: async () => {},
      sendSms: async () => {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (firstSmsFails && attempts === 1) throw new SmsApiError("101", "Authorization failed");
        delivered += 1;
        return { sent: true as const, id: `sms-${attempts}` };
      },
      onError: () => undefined,
      now: () => NOW,
    };
    const messages = ids.map(delivery);
    const outcomes = concurrent
      ? await Promise.all(messages.map((m) => handleStaffMessage(m, deps)))
      : await messages.reduce<Promise<string[]>>(async (acc, m) => [...(await acc), await handleStaffMessage(m, deps)], Promise.resolve([]));
    const saved = await store.findByMessageId("wamid.ticket");
    return { outcomes, delivered, confirmed: saved?.confirmation !== undefined };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("staff confirmation, every delivery order", () => {
  for (const concurrent of [false, true]) {
    it(`never sends the patient two SMS and never loses a confirmation (${concurrent ? "deliveries at once" : "deliveries in turn"})`, async () => {
      const failures: string[] = [];
      for (const length of [1, 2, 3]) {
        for (const ids of sequences(length)) {
          for (const firstSmsFails of [false, true]) {
            const { outcomes, delivered, confirmed } = await run(ids, firstSmsFails, concurrent);
            const label = `${ids.join(",")} first SMS ${firstSmsFails ? "fails" : "ok"}`;
            if (delivered > 1) failures.push(`${label}: patient got ${delivered} SMS (${outcomes.join(", ")})`);
            if (confirmed !== (delivered === 1)) failures.push(`${label}: confirmed=${confirmed} but ${delivered} SMS went out`);
          }
        }
      }
      assert.deepEqual(failures, []);
    });
  }
});

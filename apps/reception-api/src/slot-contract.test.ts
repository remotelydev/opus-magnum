import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slotLabel } from "./availability.js";
import { loadConfig } from "./config.js";
import { buildDevTicket } from "./whatsapp.js";

const config = loadConfig();
const monday = Date.parse("2026-10-26T13:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("slot contract between the voice agent and the ticket validator", () => {
  it("accepts every slot the agent is told to write, for every weekday and doctor", () => {
    for (const location of config.locations) {
      for (const doctor of Object.values(location.versumNames ?? {})) {
        for (let day = 0; day < 7; day++) {
          const slot = `${slotLabel(new Date(monday + day * DAY), config.timezone)}, ${doctor}`;
          assert.equal(buildDevTicket(config, { locationId: location.id, slot }).slot, slot);
        }
      }
    }
  });
});

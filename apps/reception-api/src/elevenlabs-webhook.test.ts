import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { isValidElevenLabsSignature, postCallTranscript } from "./elevenlabs-webhook.js";

const secret = "wsec_test";
const now = new Date("2026-10-25T10:00:00.000Z");
const t = Math.floor(now.getTime() / 1000);

function sign(body: string, timestamp = t) {
  const hash = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v0=${hash}`;
}

const event = {
  type: "post_call_transcription",
  event_timestamp: t,
  data: {
    agent_id: "agent_x",
    conversation_id: "conv_01abc",
    status: "done",
    transcript: [
      { role: "agent", message: "Dzień dobry, tu DentaPlus Turek.", time_in_call_secs: 0 },
      { role: "user", message: "Chciałbym umówić wizytę.", time_in_call_secs: 4 },
      { role: "agent", message: null, time_in_call_secs: 6, tool_calls: [{ tool_name: "sprawdz_wolne_terminy" }] },
    ],
    metadata: { start_time_unix_secs: t - 60, call_duration_secs: 58, termination_reason: "end_call tool" },
  },
};

describe("ElevenLabs post-call webhook", () => {
  it("accepts a valid signature and rejects a changed body, wrong secret or old timestamp", () => {
    const body = JSON.stringify(event);
    assert.equal(isValidElevenLabsSignature(Buffer.from(body), sign(body), secret, now), true);
    assert.equal(isValidElevenLabsSignature(Buffer.from(body + " "), sign(body), secret, now), false);
    assert.equal(isValidElevenLabsSignature(Buffer.from(body), sign(body), "other", now), false);
    assert.equal(isValidElevenLabsSignature(Buffer.from(body), sign(body, t - 3600), secret, now), false);
    assert.equal(isValidElevenLabsSignature(Buffer.from(body), undefined, secret, now), false);
  });

  it("turns a transcript into a record with caller and agent lines only", () => {
    const result = postCallTranscript(event);
    assert.equal(result.kind, "transcript");
    if (result.kind !== "transcript") return;
    assert.equal(result.consent, "yes");
    assert.equal(result.record.callId, "conv_01abc");
    assert.equal(result.record.handler, "ai");
    assert.equal(result.record.durationSeconds, 58);
    assert.equal(result.record.startedAt, "2026-10-25T09:59:00.000Z");
    assert.deepEqual(
      result.record.messages.map((m) => [m.role, m.text]),
      [
        ["agent", "Dzień dobry, tu DentaPlus Turek."],
        ["caller", "Chciałbym umówić wizytę."],
      ],
    );
    assert.doesNotMatch(JSON.stringify(result.record), /sprawdz_wolne_terminy/);
  });

  it("marks the call as opted out when the caller says nie zgadzam się", () => {
    const optOut = structuredClone(event);
    optOut.data.transcript[1].message = "Nie zgadzam się na nagrywanie.";
    const result = postCallTranscript(optOut);
    assert.equal(result.kind === "transcript" && result.consent, "no");
  });

  it("ignores audio and failed-call events", () => {
    assert.deepEqual(postCallTranscript({ type: "post_call_audio", data: {} }), { kind: "ignored", reason: "post_call_audio" });
    assert.equal(postCallTranscript({ type: "call_initiation_failure" }).kind, "ignored");
  });
});

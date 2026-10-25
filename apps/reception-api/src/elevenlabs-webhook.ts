import { createHmac, timingSafeEqual } from "node:crypto";
import { safeCallId, type Consent, type TranscriptMessage, type TranscriptRecord } from "./transcripts.js";

export const SIGNATURE_TOLERANCE_SECONDS = 30 * 60;

const OPT_OUT = /nie\s+zgadzam\s+si[eę]/i;

export function isValidElevenLabsSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  now = new Date(),
): boolean {
  if (!header) {
    return false;
  }
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v0) {
    return false;
  }
  if (Math.abs(now.getTime() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${parts.t}.`)
    .update(rawBody)
    .digest();
  const given = Buffer.from(parts.v0, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface TranscriptTurn {
  role?: string;
  message?: string | null;
  time_in_call_secs?: number;
}

interface PostCallData {
  conversation_id?: string;
  status?: string;
  transcript?: TranscriptTurn[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    termination_reason?: string;
  };
}

export interface PostCallEvent {
  type?: string;
  data?: PostCallData;
}

export type PostCallResult =
  | { kind: "ignored"; reason: string }
  | { kind: "transcript"; consent: Consent; record: TranscriptRecord };

export function postCallTranscript(event: PostCallEvent): PostCallResult {
  if (event.type !== "post_call_transcription") {
    return { kind: "ignored", reason: event.type ?? "unknown_type" };
  }
  const data = event.data ?? {};
  if (!data.conversation_id) {
    return { kind: "ignored", reason: "missing_conversation_id" };
  }
  const startSeconds = data.metadata?.start_time_unix_secs ?? Math.floor(Date.now() / 1000);
  const durationSeconds = Math.max(0, Math.round(data.metadata?.call_duration_secs ?? 0));
  const messages: TranscriptMessage[] = (data.transcript ?? [])
    .filter((turn) => typeof turn.message === "string" && turn.message.trim())
    .map((turn) => ({
      role: turn.role === "user" ? "caller" : "agent",
      text: (turn.message as string).trim(),
      at: new Date((startSeconds + (turn.time_in_call_secs ?? 0)) * 1000).toISOString(),
    }));
  const optedOut = messages.some((message) => message.role === "caller" && OPT_OUT.test(message.text));
  return {
    kind: "transcript",
    consent: optedOut ? "no" : "yes",
    record: {
      callId: safeCallId(data.conversation_id),
      startedAt: new Date(startSeconds * 1000).toISOString(),
      endedAt: new Date((startSeconds + durationSeconds) * 1000).toISOString(),
      durationSeconds,
      handler: "ai",
      transcriptOk: data.status === "done",
      language: "pl",
      outcome: data.metadata?.termination_reason ?? data.status ?? "unknown",
      messages,
    },
  };
}

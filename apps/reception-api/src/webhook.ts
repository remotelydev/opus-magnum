import { createHmac, timingSafeEqual } from "node:crypto";
import { findLocation, type AppConfig } from "./config.js";
import {
  formatConfirmationSms,
  parseErrorMessage,
  parseStaffReply,
} from "./staff-reply.js";
import { ticketLabel, type TicketStore } from "./tickets.js";
import type { SendSmsResult } from "./smsapi.js";

export interface WebhookEnv {
  appSecret: string;
  verifyToken: string;
}

export function resolveWebhookEnv(
  env: NodeJS.Dict<string> = process.env,
): { ok: true; config: WebhookEnv } | { ok: false; missing: string[] } {
  const appSecret = env.WHATSAPP_APP_SECRET?.trim();
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim();
  const missing: string[] = [];
  if (!appSecret) {
    missing.push("WHATSAPP_APP_SECRET");
  }
  if (!verifyToken) {
    missing.push("WHATSAPP_VERIFY_TOKEN");
  }
  if (!appSecret || !verifyToken) {
    return { ok: false, missing };
  }
  return { ok: true, config: { appSecret, verifyToken } };
}

export function verifySubscription(
  query: Record<string, string | undefined>,
  verifyToken: string,
): string | null {
  if (query["hub.mode"] !== "subscribe" || !query["hub.challenge"]) {
    return null;
  }
  const given = Buffer.from(query["hub.verify_token"] ?? "");
  const expected = Buffer.from(verifyToken);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  return query["hub.challenge"];
}

export function isValidSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=")) {
    return false;
  }
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface InboundText {
  id: string;
  from: string;
  text: string;
  contextId: string | null;
}

interface WebhookPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          context?: { id?: string };
        }>;
      };
    }>;
  }>;
}

export function extractTextMessages(payload: unknown): InboundText[] {
  const out: InboundText[] = [];
  for (const entry of (payload as WebhookPayload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") {
        continue;
      }
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text" || !message.id || !message.from || !message.text?.body) {
          continue;
        }
        out.push({
          id: message.id,
          from: message.from,
          text: message.text.body,
          contextId: message.context?.id ?? null,
        });
      }
    }
  }
  return out;
}

const digits = (value: string) => value.replace(/\D/g, "");

export type StaffReplyOutcome =
  | "ignored_sender"
  | "duplicate"
  | "no_ticket"
  | "already_confirmed"
  | "parse_error"
  | "sms_failed"
  | "confirmed";

export interface StaffReplyDeps {
  config: AppConfig;
  store: TicketStore;
  staffNumber: string;
  replyToStaff: (text: string) => Promise<void>;
  sendSms: (to: string, message: string) => Promise<SendSmsResult>;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

export async function handleStaffMessage(
  message: InboundText,
  deps: StaffReplyDeps,
): Promise<StaffReplyOutcome> {
  if (digits(message.from) !== digits(deps.staffNumber)) {
    return "ignored_sender";
  }
  if (await deps.store.hasReply(message.id)) {
    return "duplicate";
  }
  const ticket = message.contextId ? await deps.store.findByMessageId(message.contextId) : undefined;
  if (!ticket) {
    await deps.replyToStaff(
      "Odpowiedz bezpośrednio na zgłoszenie (przytrzymaj je i wybierz Odpowiedz): OK 7.10 14:30",
    );
    return "no_ticket";
  }
  const label = ticketLabel(ticket.number);
  if (ticket.confirmation) {
    await deps.replyToStaff(`${label} jest już potwierdzone (${ticket.confirmation.date} ${ticket.confirmation.time}).`);
    return "already_confirmed";
  }
  const now = deps.now?.() ?? new Date();
  const parsed = parseStaffReply(message.text, deps.config.timezone, now);
  if (!parsed.ok) {
    await deps.replyToStaff(`${label}: ${parseErrorMessage(parsed.reason)}`);
    return "parse_error";
  }
  const location = findLocation(deps.config, ticket.locationId);
  if (!location) {
    throw new Error("unknown_location");
  }
  const sms = formatConfirmationSms(location, parsed.confirmation);
  let result: SendSmsResult;
  try {
    result = await deps.sendSms(ticket.phone, sms);
  } catch (error) {
    await deps.replyToStaff(`${label}: SMS nie wysłany (błąd SMSAPI). Spróbuj ponownie lub zadzwoń do pacjenta.`);
    deps.onError?.(error);
    return "sms_failed";
  }
  await deps.store.save({
    ...ticket,
    confirmation: {
      replyMessageId: message.id,
      date: parsed.confirmation.date,
      time: parsed.confirmation.time,
      smsSent: result.sent,
      at: now.toISOString(),
    },
  });
  await deps.replyToStaff(
    result.sent
      ? `${label}: SMS wysłany do ${ticket.phone}.`
      : `${label}: SMS NIE wysłany (brak SMSAPI_TOKEN). Treść: ${sms}`,
  );
  return "confirmed";
}

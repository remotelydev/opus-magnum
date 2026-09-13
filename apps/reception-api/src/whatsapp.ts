import { findLocation, type AppConfig } from "./config.js";
import { isOpenAt } from "./script.js";

export const WHATSAPP_ENV_KEYS = [
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TO",
] as const;

export const DEFAULT_GRAPH_VERSION = "v22.0";

export type TicketHandler = "ai" | "human";
export type TicketUrgency = "normal" | "urgent";

export interface BookingTicket {
  locationId: string;
  locationName: string;
  time: string;
  timeZone: string;
  open: boolean;
  handler: TicketHandler;
  transcriptOk: boolean;
  name: string;
  phone: string;
  intent: string;
  slotWish: string;
  urgency: TicketUrgency;
  returning: boolean | null;
  summary: string;
}

export interface DevTicketBody {
  locationId?: string;
  time?: string;
  open?: boolean;
  handler?: TicketHandler;
  transcriptOk?: boolean;
  name?: string;
  phone?: string;
  intent?: string;
  slotWish?: string;
  urgency?: TicketUrgency;
  returning?: boolean | null;
  summary?: string;
}

/** Fixture booking ticket for POST /dev/ticket (patient fields; destination is WHATSAPP_TO). */
export const DEV_TICKET_FIXTURE: Required<
  Pick<
    DevTicketBody,
    | "locationId"
    | "handler"
    | "transcriptOk"
    | "name"
    | "phone"
    | "intent"
    | "slotWish"
    | "urgency"
    | "returning"
    | "summary"
  >
> = {
  locationId: "turek",
  handler: "ai",
  transcriptOk: true,
  name: "Jan Kowalski",
  phone: "+48555111222",
  intent: "book",
  slotWish: "wtorek rano",
  urgency: "normal",
  returning: false,
  summary: "Kontrola — prośba o wizytę",
};

export interface WhatsAppEnv {
  token: string;
  phoneNumberId: string;
  to: string;
  graphVersion: string;
}

export type WhatsAppEnvResult =
  | { ok: true; config: WhatsAppEnv }
  | { ok: false; missing: string[] };

export interface SendTextResult {
  messageId: string;
}

export class WhatsAppSendError extends Error {
  readonly status: number;
  readonly details: string;

  constructor(status: number, details: string) {
    super(`whatsapp_send_failed:${status}`);
    this.name = "WhatsAppSendError";
    this.status = status;
    this.details = details;
  }
}

function readEnv(name: string, env: NodeJS.Dict<string>): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function resolveWhatsAppEnv(
  env: NodeJS.Dict<string> = process.env,
): WhatsAppEnvResult {
  const token = readEnv("WHATSAPP_TOKEN", env);
  const phoneNumberId = readEnv("WHATSAPP_PHONE_NUMBER_ID", env);
  const to = readEnv("WHATSAPP_TO", env);
  const missing: string[] = [];
  if (!token) {
    missing.push("WHATSAPP_TOKEN");
  }
  if (!phoneNumberId) {
    missing.push("WHATSAPP_PHONE_NUMBER_ID");
  }
  if (!to) {
    missing.push("WHATSAPP_TO");
  }
  if (missing.length > 0 || !token || !phoneNumberId || !to) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    config: {
      token,
      phoneNumberId,
      to,
      graphVersion: readEnv("WHATSAPP_GRAPH_VERSION", env) ?? DEFAULT_GRAPH_VERSION,
    },
  };
}

export function formatTicketTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

const INTENT_PL: Record<string, string> = {
  book: "wizyta",
  emergency: "pilne",
  human: "połączenie z recepcją",
  hours: "godziny",
  other: "inne",
};

function intentLabel(intent: string): string {
  return INTENT_PL[intent] ?? intent;
}

function returningLabel(returning: boolean | null): string {
  if (returning === true) {
    return "powracający";
  }
  if (returning === false) {
    return "nowy";
  }
  return "nie podano";
}

export function formatTicketMessage(ticket: BookingTicket): string {
  return [
    `Zgłoszenie — ${ticket.locationName}`,
    "",
    `Czas: ${ticket.time} (${ticket.timeZone})`,
    `Godziny: ${ticket.open ? "otwarte" : "nieczynne"}`,
    `Obsługa: ${ticket.handler === "human" ? "człowiek" : "AI"}`,
    `Transkrypcja: ${ticket.transcriptOk ? "tak" : "nie"}`,
    `Imię i nazwisko: ${ticket.name}`,
    `Telefon: ${ticket.phone}`,
    `Zamiar: ${intentLabel(ticket.intent)}`,
    `Termin: ${ticket.slotWish}`,
    `Pilność: ${ticket.urgency === "urgent" ? "pilne" : "zwykła"}`,
    `Pacjent: ${returningLabel(ticket.returning)}`,
    `Opis: ${ticket.summary}`,
  ].join("\n");
}

export function buildDevTicket(
  config: AppConfig,
  body: DevTicketBody = {},
  now = new Date(),
): BookingTicket {
  const locationId = body.locationId ?? DEV_TICKET_FIXTURE.locationId;
  const location = findLocation(config, locationId);
  if (!location) {
    throw new Error("unknown_location");
  }
  const at = body.time ? new Date(body.time) : now;
  if (Number.isNaN(at.getTime())) {
    throw new Error("invalid_datetime");
  }
  const open = body.open ?? isOpenAt(location.hours, at, config.timezone);
  return {
    locationId: location.id,
    locationName: location.name,
    time: formatTicketTime(at, config.timezone),
    timeZone: config.timezone,
    open,
    handler: body.handler === "human" ? "human" : DEV_TICKET_FIXTURE.handler,
    transcriptOk: body.transcriptOk ?? DEV_TICKET_FIXTURE.transcriptOk,
    name: body.name ?? DEV_TICKET_FIXTURE.name,
    phone: body.phone ?? DEV_TICKET_FIXTURE.phone,
    intent: body.intent ?? DEV_TICKET_FIXTURE.intent,
    slotWish: body.slotWish ?? DEV_TICKET_FIXTURE.slotWish,
    urgency: body.urgency === "urgent" ? "urgent" : DEV_TICKET_FIXTURE.urgency,
    returning: body.returning === undefined ? DEV_TICKET_FIXTURE.returning : body.returning,
    summary: body.summary ?? DEV_TICKET_FIXTURE.summary,
  };
}

interface GraphMessageResponse {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; type?: string; code?: number };
}

export async function sendWhatsAppText(options: {
  token: string;
  phoneNumberId: string;
  to: string;
  body: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}): Promise<SendTextResult> {
  if (!/^\d+$/.test(options.phoneNumberId)) {
    throw new WhatsAppSendError(500, "invalid_phone_number_id");
  }
  const version = options.graphVersion ?? DEFAULT_GRAPH_VERSION;
  const url = `https://graph.facebook.com/${version}/${options.phoneNumberId}/messages`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: options.to,
      type: "text",
      text: { body: options.body, preview_url: false },
    }),
  });
  const raw = await response.text();
  let parsed: GraphMessageResponse = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as GraphMessageResponse;
    } catch {
      throw new WhatsAppSendError(response.status, "invalid_graph_json");
    }
  }
  const messageId = parsed.messages?.[0]?.id;
  if (!response.ok || !messageId) {
    const details =
      parsed.error?.message ??
      (raw.trim() ? raw.slice(0, 300) : `graph_http_${response.status}`);
    throw new WhatsAppSendError(response.status, details);
  }
  return { messageId };
}

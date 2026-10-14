import { findLocation, type AppConfig } from "./config.js";

export const WHATSAPP_ENV_KEYS = [
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TO",
] as const;

export const DEFAULT_GRAPH_VERSION = "v22.0";

/** Closed list, so no free text can reach Meta through this field. */
export const TICKET_CATEGORIES = ["book", "callback", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

const SLOT_MAX_LENGTH = 40;
const NAME_MAX_LENGTH = 80;

/**
 * Minimal booking ticket. It must never carry a transcript, symptoms,
 * or a free-text visit reason: only these fields go to Meta.
 */
export interface BookingTicket {
  locationId: string;
  site: string;
  receivedAt: string;
  name: string;
  phone: string;
  category: TicketCategory;
  slot: string;
  urgent: boolean;
  returning: boolean | null;
}

export interface DevTicketBody {
  locationId?: string;
  time?: string;
  name?: string;
  phone?: string;
  category?: string;
  slot?: string;
  urgent?: boolean;
  returning?: boolean | null;
}

/** Fixture booking ticket for POST /dev/ticket (sample patient; destination is WHATSAPP_TO). */
export const DEV_TICKET_FIXTURE = {
  locationId: "turek",
  name: "Jan Kowalski",
  phone: "+48555111222",
  category: "book",
  slot: "wtorek rano",
  urgent: false,
  returning: false,
} as const satisfies Required<Omit<DevTicketBody, "time">>;

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
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}.${get("month")} ${get("hour")}:${get("minute")}`;
}

const CATEGORY_PL: Record<TicketCategory, string> = {
  book: "wizyta",
  callback: "oddzwonić",
  other: "inne",
};

function isCategory(value: string): value is TicketCategory {
  return (TICKET_CATEGORIES as readonly string[]).includes(value);
}

function siteLabel(config: AppConfig, locationName: string): string {
  return locationName.replace(config.brand, "").trim() || locationName;
}

/** One line, e.g. `PILNE · Turek · wizyta · nowy · wtorek rano · Jan Kowalski · +48555111222 · 14.09 10:00`. */
export function formatTicketMessage(ticket: BookingTicket): string {
  const parts = [
    ticket.urgent ? "PILNE" : null,
    ticket.site,
    CATEGORY_PL[ticket.category],
    ticket.returning === null ? null : ticket.returning ? "powracający" : "nowy",
    ticket.slot,
    ticket.name,
    ticket.phone,
    ticket.receivedAt,
  ];
  return parts.filter((part): part is string => part !== null).join(" · ");
}

function oneLine(value: string, max: number, error: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > max) {
    throw new Error(error);
  }
  return text;
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
  const category = body.category ?? DEV_TICKET_FIXTURE.category;
  if (!isCategory(category)) {
    throw new Error("invalid_category");
  }
  const phone = (body.phone ?? DEV_TICKET_FIXTURE.phone).replace(/[\s-]/g, "");
  if (!/^\+?\d{9,15}$/.test(phone)) {
    throw new Error("invalid_phone");
  }
  return {
    locationId: location.id,
    site: siteLabel(config, location.name),
    receivedAt: formatTicketTime(at, config.timezone),
    name: oneLine(body.name ?? DEV_TICKET_FIXTURE.name, NAME_MAX_LENGTH, "invalid_name"),
    phone,
    category,
    slot: oneLine(body.slot ?? DEV_TICKET_FIXTURE.slot, SLOT_MAX_LENGTH, "invalid_slot"),
    urgent: body.urgent === true,
    returning: body.returning === undefined ? DEV_TICKET_FIXTURE.returning : body.returning,
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

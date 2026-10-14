import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { findLocation, loadConfig } from "./config.js";
import { getCachedPricelist } from "./prismic.js";
import {
  createTranscriptStore,
  RETENTION_DAYS,
  safeCallId,
  type Consent,
  type HandlerKind,
  type TranscriptMessage,
  type TranscriptRecord,
} from "./transcripts.js";
import {
  buildDevTicket,
  formatTicketMessage,
  resolveWhatsAppEnv,
  sendWhatsAppText,
  WhatsAppSendError,
  type BookingTicket,
  type DevTicketBody,
} from "./whatsapp.js";

const localEnvPath = join(dirname(fileURLToPath(import.meta.url)), "../.env");
if (existsSync(localEnvPath)) {
  for (const rawLine of readFileSync(localEnvPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const config = loadConfig();

const host = process.env.HOST ?? config.server.host;
const port = Number(process.env.PORT ?? config.server.port);

const store = createTranscriptStore({
  timeZone: config.timezone,
});

const app = Fastify({
  logger: true,
});

if (!process.env.TRANSCRIPT_KEY) {
  app.log.warn(
    "TRANSCRIPT_KEY missing; POST /dev/transcripts will fail until it is set",
  );
}

const whatsappEnv = resolveWhatsAppEnv();
if (!whatsappEnv.ok) {
  app.log.warn(
    { missing: whatsappEnv.missing },
    "WhatsApp Cloud API env missing; POST /dev/ticket will fail until it is set",
  );
}

interface DevTranscriptBody {
  callId?: string;
  consent?: Consent;
  transcribe?: boolean;
  startedAt?: string;
  endedAt?: string;
  handler?: HandlerKind;
  outcome?: string;
  messages?: TranscriptMessage[];
}

interface DevPurgeBody {
  dryRun?: boolean;
  seed?: boolean;
}

const FAKE_MESSAGES: TranscriptMessage[] = [
  {
    role: "agent",
    text: "DentaPlus+ Turek. Rozmowa może być nagrywana na potrzeby jakości obsługi.",
  },
  { role: "caller", text: "Chciałem zapytać o godziny otwarcia." },
  {
    role: "agent",
    text: "Poniedziałek–piątek 08:00–20:00, sobota 10:00–15:00, niedziela nieczynne.",
  },
];

function parseIso(value: string | undefined, fallback: Date): Date {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("invalid_datetime");
  }
  return parsed;
}

function fakeRecord(body: DevTranscriptBody, clock: Date): TranscriptRecord {
  const endedAt = parseIso(body.endedAt, clock);
  const startedAt = parseIso(
    body.startedAt,
    new Date(endedAt.getTime() - 45_000),
  );
  const durationSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
  );
  return {
    callId: safeCallId(body.callId),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
    handler: body.handler === "human" ? "human" : "ai",
    transcriptOk: true,
    language: "pl",
    outcome: body.outcome ?? "dev_fake",
    messages: body.messages ?? FAKE_MESSAGES,
  };
}

app.get("/health", async () => {
  return { ok: true, service: "reception-api" };
});

async function loadPricelist() {
  return getCachedPricelist({
    api: config.prismic.api,
    cennikUid: config.prismic.cennikUid,
    lang: config.prismic.lang,
  });
}

app.get("/config", async (_request, reply) => {
  try {
    const pricelist = await loadPricelist();
    return { ...config, pricelist };
  } catch (error) {
    requestLog(error);
    return reply.code(200).send({
      ...config,
      pricelist: null,
      pricelistError: "prismic_unavailable",
    });
  }
});

app.get("/pricelist", async (_request, reply) => {
  try {
    return await loadPricelist();
  } catch (error) {
    requestLog(error);
    return reply.code(502).send({ error: "prismic_unavailable" });
  }
});

app.get<{ Params: { id: string } }>("/config/:id", async (request, reply) => {
  const location = findLocation(config, request.params.id);
  if (!location) {
    return reply.code(404).send({
      error: "unknown_location",
      id: request.params.id,
    });
  }
  try {
    const pricelist = await loadPricelist();
    return { ...location, pricelist };
  } catch (error) {
    requestLog(error);
    return reply.code(200).send({
      ...location,
      pricelist: null,
      pricelistError: "prismic_unavailable",
    });
  }
});

app.post<{ Body: DevTranscriptBody }>("/dev/transcripts", async (request, reply) => {
  const body = request.body ?? {};
  try {
    const result = await store.write({
      consent: body.consent,
      transcribe: body.transcribe,
      record: fakeRecord(body, new Date()),
    });
    if (!result.stored) {
      return { ok: true, stored: false, reason: result.reason };
    }
    return {
      ok: true,
      stored: true,
      path: `transcripts/${result.relativePath}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "transcript_write_failed";
    if (message === "missing_transcript_key" || message.startsWith("TRANSCRIPT_KEY")) {
      return reply.code(500).send({ error: "missing_transcript_key" });
    }
    if (message === "invalid_datetime") {
      return reply.code(400).send({ error: "invalid_datetime" });
    }
    requestLog(error);
    return reply.code(500).send({ error: "transcript_write_failed" });
  }
});

app.post<{ Body: DevPurgeBody }>("/dev/purge-old", async (request) => {
  const body = request.body ?? {};
  const dryRun = body.dryRun !== false;
  const seed = body.seed ?? dryRun;
  if (seed) {
    await store.seedOldFolder(RETENTION_DAYS + 1);
  }
  const result = await store.purgeOld(dryRun);
  return { ok: true, ...result };
});

const TICKET_INPUT_ERRORS = new Set([
  "invalid_datetime",
  "invalid_category",
  "invalid_phone",
  "invalid_name",
  "invalid_slot",
]);

app.post<{ Body: DevTicketBody }>("/dev/ticket", async (request, reply) => {
  const body = request.body ?? {};
  let ticket: BookingTicket;
  try {
    ticket = buildDevTicket(config, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ticket_failed";
    if (message === "unknown_location") {
      return reply.code(404).send({
        error: "unknown_location",
        id: body.locationId,
      });
    }
    if (TICKET_INPUT_ERRORS.has(message)) {
      return reply.code(400).send({ error: message });
    }
    requestLog(error);
    return reply.code(500).send({ error: "ticket_failed" });
  }
  const text = formatTicketMessage(ticket);
  const env = resolveWhatsAppEnv();
  if (!env.ok) {
    return reply.code(503).send({
      error: "missing_whatsapp_env",
      missing: env.missing,
      sent: false,
      ticket,
      text,
    });
  }
  try {
    const sent = await sendWhatsAppText({
      token: env.config.token,
      phoneNumberId: env.config.phoneNumberId,
      to: env.config.to,
      graphVersion: env.config.graphVersion,
      body: text,
    });
    return {
      ok: true,
      sent: true,
      to: env.config.to,
      messageId: sent.messageId,
      ticket,
      text,
    };
  } catch (error) {
    if (error instanceof WhatsAppSendError) {
      return reply.code(502).send({
        error: "whatsapp_send_failed",
        status: error.status,
        details: error.details,
        sent: false,
        ticket,
        text,
      });
    }
    requestLog(error);
    return reply.code(502).send({ error: "whatsapp_send_failed", sent: false });
  }
});

function requestLog(error: unknown) {
  app.log.error(error);
}

await app.listen({ host, port });

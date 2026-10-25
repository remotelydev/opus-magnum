import Fastify from "fastify";
import { findLocation, loadConfig } from "./config.js";
import { loadLocalEnv } from "./env.js";
import { agentAvailabilityQuery, agentTicketBody, hoursAnswer, isValidToolSecret } from "./agent.js";
import { findFreeSlots, loadVersumCalendar, type VersumCalendar } from "./availability.js";
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
import { createTicketStore, ticketLabel } from "./tickets.js";
import { isValidElevenLabsSignature, postCallTranscript, type PostCallEvent } from "./elevenlabs-webhook.js";
import { resolveSmsApiEnv, sendSms } from "./smsapi.js";
import {
  extractTextMessages,
  handleStaffMessage,
  isValidSignature,
  resolveWebhookEnv,
  verifySubscription,
} from "./webhook.js";
import {
  buildDevTicket,
  formatTicketMessage,
  resolveWhatsAppEnv,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  WhatsAppSendError,
  type BookingTicket,
  type DevTicketBody,
} from "./whatsapp.js";

loadLocalEnv();

const config = loadConfig();

const host = process.env.HOST ?? config.server.host;
const port = Number(process.env.PORT ?? config.server.port);

const store = createTranscriptStore({
  timeZone: config.timezone,
});

const tickets = createTicketStore();

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

const webhookEnv = resolveWebhookEnv();
if (!webhookEnv.ok) {
  app.log.warn(
    { missing: webhookEnv.missing },
    "WhatsApp webhook env missing; /webhooks/whatsapp will refuse requests until it is set",
  );
}
if (!resolveSmsApiEnv()) {
  app.log.warn("SMSAPI_TOKEN missing; confirmation SMS will be logged, not sent");
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

interface Delivery {
  status: number;
  body: Record<string, unknown>;
}

async function deliverTicket(ticket: BookingTicket): Promise<Delivery> {
  const env = resolveWhatsAppEnv();
  if (!env.ok) {
    const text = formatTicketMessage(ticket);
    return {
      status: 503,
      body: { error: "missing_whatsapp_env", missing: env.missing, sent: false, ticket, text },
    };
  }
  const number = await tickets.nextNumber();
  const text = formatTicketMessage(ticket, number);
  const via = env.config.ticketTemplate ? "template" : "text";
  try {
    const target = {
      token: env.config.token,
      phoneNumberId: env.config.phoneNumberId,
      to: env.config.to,
      graphVersion: env.config.graphVersion,
    };
    const sent = env.config.ticketTemplate
      ? await sendWhatsAppTemplate({
          ...target,
          name: env.config.ticketTemplate,
          language: env.config.templateLanguage,
          bodyParams: [ticketLabel(number), formatTicketMessage(ticket)],
        })
      : await sendWhatsAppText({ ...target, body: text });
    await tickets.save({
      number,
      messageId: sent.messageId,
      phone: ticket.phone,
      locationId: ticket.locationId,
      createdAt: new Date().toISOString(),
    });
    return {
      status: 200,
      body: {
        ok: true,
        sent: true,
        to: env.config.to,
        messageId: sent.messageId,
        via,
        number,
        ticket,
        text,
      },
    };
  } catch (error) {
    if (error instanceof WhatsAppSendError) {
      return {
        status: 502,
        body: {
          error: "whatsapp_send_failed",
          status: error.status,
          details: error.details,
          sent: false,
          ticket,
          text,
        },
      };
    }
    requestLog(error);
    return { status: 502, body: { error: "whatsapp_send_failed", sent: false } };
  }
}

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
  const delivery = await deliverTicket(ticket);
  return reply.code(delivery.status).send(delivery.body);
});

const agentToolSecret = process.env.ELEVENLABS_TOOL_SECRET?.trim();
if (!agentToolSecret) {
  app.log.warn("ELEVENLABS_TOOL_SECRET missing; /agent/* tool routes will refuse requests");
}

app.register(async (agentScope) => {
  agentScope.addHook("onRequest", async (request, reply) => {
    if (!agentToolSecret) {
      return reply.code(503).send({ error: "missing_tool_secret" });
    }
    if (!isValidToolSecret(request.headers["x-agent-secret"], agentToolSecret)) {
      return reply.code(401).send({ error: "invalid_tool_secret" });
    }
  });

  agentScope.get<{ Params: { site: string } }>("/agent/hours/:site", async (request, reply) => {
    const location = findLocation(config, request.params.site);
    if (!location) {
      return reply.code(404).send({ error: "unknown_location" });
    }
    return hoursAnswer(config, location);
  });

  agentScope.get<{ Params: { site: string }; Querystring: Record<string, string | undefined> }>(
    "/agent/availability/:site",
    async (request, reply) => {
      const location = findLocation(config, request.params.site);
      if (!location) {
        return reply.code(404).send({ error: "unknown_location" });
      }
      let calendar: VersumCalendar;
      try {
        calendar = loadVersumCalendar();
      } catch (error) {
        requestLog(error);
        return reply.code(503).send({ error: "no_versum_export" });
      }
      return findFreeSlots(calendar, location, agentAvailabilityQuery(request.query), config.timezone);
    },
  );

  agentScope.post<{ Params: { site: string } }>("/agent/ticket/:site", async (request, reply) => {
    let ticket: BookingTicket;
    try {
      ticket = buildDevTicket(config, agentTicketBody(request.params.site, request.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "ticket_failed";
      if (message === "unknown_location") {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
    const delivery = await deliverTicket(ticket);
    if (delivery.status !== 200) {
      return reply.code(delivery.status).send({ error: delivery.body.error });
    }
    return { ok: true, ticket: ticketLabel(delivery.body.number as number) };
  });
});

app.get<{ Querystring: Record<string, string | undefined> }>(
  "/webhooks/whatsapp",
  async (request, reply) => {
    const env = resolveWebhookEnv();
    if (!env.ok) {
      return reply.code(503).send({ error: "missing_webhook_env", missing: env.missing });
    }
    const challenge = verifySubscription(request.query, env.config.verifyToken);
    if (challenge === null) {
      return reply.code(403).send({ error: "verification_failed" });
    }
    return reply.type("text/plain").send(challenge);
  },
);

await app.register(async (scope) => {
  scope.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  scope.post<{ Body: Buffer }>("/webhooks/whatsapp", async (request, reply) => {
    const env = resolveWebhookEnv();
    if (!env.ok) {
      return reply.code(503).send({ error: "missing_webhook_env", missing: env.missing });
    }
    const signature = request.headers["x-hub-signature-256"];
    if (
      !Buffer.isBuffer(request.body) ||
      !isValidSignature(request.body, typeof signature === "string" ? signature : undefined, env.config.appSecret)
    ) {
      return reply.code(401).send({ error: "invalid_signature" });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(request.body.toString("utf8"));
    } catch {
      return reply.code(400).send({ error: "invalid_json" });
    }
    const whatsapp = resolveWhatsAppEnv();
    if (!whatsapp.ok) {
      app.log.error({ missing: whatsapp.missing }, "webhook received but WhatsApp env missing");
      return { ok: true };
    }
    const wa = whatsapp.config;
    for (const message of extractTextMessages(payload)) {
      try {
        const outcome = await handleStaffMessage(message, {
          config,
          store: tickets,
          staffNumber: wa.to,
          replyToStaff: async (text) => {
            await sendWhatsAppText({
              token: wa.token,
              phoneNumberId: wa.phoneNumberId,
              to: wa.to,
              graphVersion: wa.graphVersion,
              body: text,
            });
          },
          sendSms: (to, text) =>
            sendSms({
              env: resolveSmsApiEnv(),
              to,
              message: text,
              log: (line) => app.log.warn(line),
            }),
          onError: requestLog,
        });
        app.log.info({ messageId: message.id, outcome }, "staff reply handled");
      } catch (error) {
        requestLog(error);
      }
    }
    return { ok: true };
  });

  scope.post<{ Body: Buffer }>("/webhooks/elevenlabs", async (request, reply) => {
    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
    if (!secret) {
      return reply.code(503).send({ error: "missing_webhook_secret" });
    }
    const signature = request.headers["elevenlabs-signature"];
    if (
      !Buffer.isBuffer(request.body) ||
      !isValidElevenLabsSignature(request.body, typeof signature === "string" ? signature : undefined, secret)
    ) {
      return reply.code(401).send({ error: "invalid_signature" });
    }
    let event: PostCallEvent;
    try {
      event = JSON.parse(request.body.toString("utf8")) as PostCallEvent;
    } catch {
      return reply.code(400).send({ error: "invalid_json" });
    }
    const result = postCallTranscript(event);
    if (result.kind === "ignored") {
      return { ok: true, stored: false, reason: result.reason };
    }
    try {
      const written = await store.write({ consent: result.consent, record: result.record });
      return written.stored
        ? { ok: true, stored: true }
        : { ok: true, stored: false, reason: written.reason };
    } catch (error) {
      requestLog(error);
      return reply.code(500).send({ error: "transcript_write_failed" });
    }
  });
});

function requestLog(error: unknown) {
  app.log.error(error);
}

await app.listen({ host, port });

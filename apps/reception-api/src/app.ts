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
  type TranscriptStoreOptions,
} from "./transcripts.js";

export interface BuildAppOptions {
  transcripts?: TranscriptStoreOptions;
  logger?: boolean;
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

export async function buildApp(options: BuildAppOptions = {}) {
  const config = loadConfig();
  const store = createTranscriptStore({
    timeZone: config.timezone,
    ...options.transcripts,
  });

  const app = Fastify({
    logger: options.logger ?? true,
  });

  if (!options.transcripts?.key && !process.env.TRANSCRIPT_KEY) {
    app.log.warn(
      "TRANSCRIPT_KEY missing; POST /dev/transcripts will fail until it is set",
    );
  }

  async function loadPricelist() {
    return getCachedPricelist({
      api: config.prismic.api,
      cennikUid: config.prismic.cennikUid,
      lang: config.prismic.lang,
    });
  }

  function requestLog(error: unknown) {
    app.log.error(error);
  }

  app.get("/health", async () => {
    return { ok: true, service: "reception-api" };
  });

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
        record: fakeRecord(body, options.transcripts?.now?.() ?? new Date()),
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

  return app;
}

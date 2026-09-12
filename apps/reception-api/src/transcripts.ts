import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RETENTION_DAYS = 32;
export const TRANSCRIPT_EXT = ".json.enc";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_HEX_LENGTH = 64;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function defaultTranscriptsDir(): string {
  return process.env.TRANSCRIPTS_DIR ?? join(packageRoot, "transcripts");
}

export type Consent = "pending" | "yes" | "no";
export type HandlerKind = "ai" | "human";

export interface TranscriptMessage {
  role: string;
  text: string;
  at?: string;
}

export interface TranscriptRecord {
  callId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  handler: HandlerKind;
  transcriptOk: boolean;
  language: "pl";
  outcome: string;
  messages: TranscriptMessage[];
}

export interface WriteInput {
  consent?: Consent;
  transcribe?: boolean;
  record: TranscriptRecord;
}

export type WriteResult =
  | { stored: false; reason: "opt-out" }
  | { stored: true; folder: string; file: string; relativePath: string };

export interface PurgeResult {
  dryRun: boolean;
  retentionDays: number;
  today: string;
  folders: string[];
}

export interface TranscriptStoreOptions {
  rootDir?: string;
  key?: Buffer;
  timeZone?: string;
  now?: () => Date;
  retentionDays?: number;
}

interface EnvelopeV1 {
  v: 1;
  alg: typeof ALGO;
  iv: string;
  tag: string;
  data: string;
}

export function shouldWriteTranscript(input: {
  consent?: Consent;
  transcribe?: boolean;
}): boolean {
  if (input.consent === "no" || input.consent === "pending") {
    return false;
  }
  if (input.transcribe === false) {
    return false;
  }
  return true;
}

export function parseTranscriptKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  const fromBase64 = Buffer.from(value, "base64");
  if (fromBase64.length === 32) {
    return fromBase64;
  }
  throw new Error(
    `TRANSCRIPT_KEY must be 32 bytes (64 hex chars, e.g. openssl rand -hex ${KEY_HEX_LENGTH / 2})`,
  );
}

export function resolveTranscriptKey(raw = process.env.TRANSCRIPT_KEY): Buffer {
  if (!raw) {
    throw new Error("missing_transcript_key");
  }
  return parseTranscriptKey(raw);
}

export function calendarDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function shiftCalendarDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const yyyy = String(utc.getUTCFullYear());
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function folderAgeDays(folderDate: string, today: string): number {
  const [y1, m1, d1] = folderDate.split("-").map(Number);
  const [y2, m2, d2] = today.split("-").map(Number);
  const start = Date.UTC(y1, m1 - 1, d1);
  const end = Date.UTC(y2, m2 - 1, d2);
  return Math.round((end - start) / 86_400_000);
}

export function encryptTranscript(key: Buffer, record: TranscriptRecord): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(record), "utf8");
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: EnvelopeV1 = {
    v: 1,
    alg: ALGO,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptTranscript(key: Buffer, fileText: string): TranscriptRecord {
  const envelope = JSON.parse(fileText) as EnvelopeV1;
  if (envelope.v !== 1 || envelope.alg !== ALGO) {
    throw new Error("unsupported_transcript_envelope");
  }
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const data = Buffer.from(envelope.data, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as TranscriptRecord;
}

export function safeCallId(raw?: string): string {
  const safe = (raw ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "");
  return safe.length > 0 ? safe : randomUUID();
}

function isDateFolder(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(name);
}

export function createTranscriptStore(options: TranscriptStoreOptions = {}) {
  const rootDir = options.rootDir ?? defaultTranscriptsDir();
  const timeZone = options.timeZone ?? "Europe/Warsaw";
  const retentionDays = options.retentionDays ?? RETENTION_DAYS;
  const now = options.now ?? (() => new Date());

  function requireKey(): Buffer {
    if (options.key) {
      return options.key;
    }
    return resolveTranscriptKey();
  }

  return {
    rootDir,
    retentionDays,
    shouldWrite: shouldWriteTranscript,

    async write(input: WriteInput): Promise<WriteResult> {
      if (!shouldWriteTranscript(input)) {
        return { stored: false, reason: "opt-out" };
      }
      const key = requireKey();
      const folder = calendarDate(new Date(input.record.startedAt), timeZone);
      const file = `${input.record.callId}${TRANSCRIPT_EXT}`;
      const dir = join(rootDir, folder);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, file), encryptTranscript(key, input.record), "utf8");
      return {
        stored: true,
        folder,
        file,
        relativePath: `${folder}/${file}`,
      };
    },

    async read(relativePath: string): Promise<TranscriptRecord> {
      const text = await readFile(join(rootDir, relativePath), "utf8");
      return decryptTranscript(requireKey(), text);
    },

    async seedOldFolder(ageDays: number): Promise<string> {
      const today = calendarDate(now(), timeZone);
      const folder = shiftCalendarDate(today, -ageDays);
      await mkdir(join(rootDir, folder), { recursive: true });
      return folder;
    },

    async purgeOld(dryRun: boolean): Promise<PurgeResult> {
      const today = calendarDate(now(), timeZone);
      await mkdir(rootDir, { recursive: true });
      const entries = await readdir(rootDir, { withFileTypes: true });
      const folders = entries
        .filter((entry) => entry.isDirectory() && isDateFolder(entry.name))
        .map((entry) => entry.name)
        .filter((name) => folderAgeDays(name, today) > retentionDays)
        .sort();

      if (!dryRun) {
        await Promise.all(
          folders.map((folder) => rm(join(rootDir, folder), { recursive: true, force: true })),
        );
      }

      return { dryRun, retentionDays, today, folders };
    },
  };
}

export type TranscriptStore = ReturnType<typeof createTranscriptStore>;

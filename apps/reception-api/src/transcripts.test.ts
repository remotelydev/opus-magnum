import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  createTranscriptStore,
  decryptTranscript,
  encryptTranscript,
  shouldWriteTranscript,
  type TranscriptRecord,
} from "./transcripts.js";

const tz = "Europe/Warsaw";
const now = new Date("2026-09-12T12:00:00.000Z");

function sampleRecord(overrides: Partial<TranscriptRecord> = {}): TranscriptRecord {
  return {
    callId: "call-1",
    startedAt: now.toISOString(),
    endedAt: new Date(now.getTime() + 45_000).toISOString(),
    durationSeconds: 45,
    handler: "ai",
    transcriptOk: true,
    language: "pl",
    outcome: "hours",
    messages: [{ role: "caller", text: "Jakie są godziny?" }],
    ...overrides,
  };
}

async function tempStore() {
  const rootDir = await mkdtemp(join(tmpdir(), "reception-transcripts-"));
  const key = randomBytes(32);
  const store = createTranscriptStore({
    rootDir,
    key,
    timeZone: tz,
    now: () => now,
  });
  return { rootDir, key, store };
}

describe("opt-out", () => {
  it("skips write while consent is pending", () => {
    assert.equal(shouldWriteTranscript({ consent: "pending" }), false);
  });
});

describe("transcript store", () => {
  const dirs: string[] = [];

  after(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("writes encrypted JSON and no audio files", async () => {
    const { rootDir, key, store } = await tempStore();
    dirs.push(rootDir);

    const result = await store.write({
      consent: "yes",
      record: sampleRecord(),
    });
    assert.equal(result.stored, true);
    if (!result.stored) {
      return;
    }

    const onDisk = await readFile(join(rootDir, result.relativePath), "utf8");
    assert.doesNotMatch(onDisk, /Jakie są godziny/);
    const envelope = JSON.parse(onDisk) as { alg: string; data: string };
    assert.equal(envelope.alg, "aes-256-gcm");

    const decoded = decryptTranscript(key, onDisk);
    assert.equal(decoded.callId, "call-1");
    assert.equal(decoded.language, "pl");
    assert.equal(decoded.handler, "ai");
    assert.equal(decoded.transcriptOk, true);
    assert.equal(decoded.messages[0]?.text, "Jakie są godziny?");
    assert.deepEqual(decoded, await store.read(result.relativePath));

    const names = await readdir(join(rootDir, result.folder));
    assert.deepEqual(names, ["call-1.json.enc"]);
    assert.equal(
      names.some((name) => /\.(wav|mp3|ogg|webm|m4a)$/i.test(name)),
      false,
    );
  });

  it("does not create a file on opt-out", async () => {
    const { rootDir, store } = await tempStore();
    dirs.push(rootDir);

    const result = await store.write({
      consent: "no",
      record: sampleRecord({ callId: "opt-out" }),
    });
    assert.equal(result.stored, false);
    if (result.stored) {
      return;
    }
    assert.equal(result.reason, "opt-out");
    const names = await readdir(rootDir);
    assert.deepEqual(names, []);
  });

  it("does not create a file when transcribe is false", async () => {
    const { rootDir, store } = await tempStore();
    dirs.push(rootDir);

    const result = await store.write({
      consent: "yes",
      transcribe: false,
      record: sampleRecord({ callId: "no-stt" }),
    });
    assert.equal(result.stored, false);
    assert.deepEqual(await readdir(rootDir), []);
  });

  it("fails to decrypt with the wrong key", async () => {
    const record = sampleRecord();
    const blob = encryptTranscript(randomBytes(32), record);
    assert.throws(() => decryptTranscript(randomBytes(32), blob));
  });
});

describe("purge", () => {
  const dirs: string[] = [];

  after(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("dry-run lists a 33-day folder and leaves it", async () => {
    const { rootDir, store } = await tempStore();
    dirs.push(rootDir);

    const folder33 = await store.seedOldFolder(33);
    const folder32 = await store.seedOldFolder(32);
    const folderToday = await store.seedOldFolder(0);

    const result = await store.purgeOld(true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.folders, [folder33]);
    assert.equal(result.retentionDays, 32);

    const remaining = (await readdir(rootDir)).sort();
    assert.deepEqual(remaining, [folder33, folder32, folderToday].sort());
  });

  it("deletes folders older than 32 days", async () => {
    const { rootDir, store } = await tempStore();
    dirs.push(rootDir);

    const folder33 = await store.seedOldFolder(33);
    const folder32 = await store.seedOldFolder(32);

    const result = await store.purgeOld(false);
    assert.equal(result.dryRun, false);
    assert.deepEqual(result.folders, [folder33]);

    const remaining = await readdir(rootDir);
    assert.deepEqual(remaining, [folder32]);
  });
});

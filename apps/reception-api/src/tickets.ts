import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Same retention as transcripts: a ticket carries a patient phone number. */
export const TICKET_RETENTION_DAYS = 32;

/**
 * What the OK reply needs to find its way back to the patient. No name,
 * slot or category: those already went to WhatsApp and are not needed here.
 */
export interface TicketRecord {
  number: number;
  messageId: string;
  phone: string;
  locationId: string;
  createdAt: string;
  confirmation?: {
    replyMessageId: string;
    date: string;
    time: string;
    smsSent: boolean;
    at: string;
  };
}

interface TicketFile {
  lastNumber: number;
  tickets: TicketRecord[];
}

export function ticketsDir(env: NodeJS.Dict<string> = process.env): string {
  return env.TICKETS_DIR ?? join(packageRoot, "data");
}

/** `#T-0412`: one counter for both sites. */
export function ticketLabel(number: number): string {
  return `#T-${String(number).padStart(4, "0")}`;
}

export interface TicketStore {
  /** Reserves the next number before the WhatsApp send, so the ticket text can carry it. */
  nextNumber(): Promise<number>;
  save(record: TicketRecord): Promise<void>;
  findByMessageId(messageId: string): Promise<TicketRecord | undefined>;
  hasReply(replyMessageId: string): Promise<boolean>;
}

export function createTicketStore(options: { dir?: string } = {}): TicketStore {
  const dir = options.dir ?? ticketsDir();
  const path = join(dir, "tickets.json");
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<TicketFile> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as TicketFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { lastNumber: 0, tickets: [] };
      }
      throw error;
    }
  }

  async function store(file: TicketFile, now: Date): Promise<void> {
    const cutoff = now.getTime() - TICKET_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    file.tickets = file.tickets.filter((t) => new Date(t.createdAt).getTime() >= cutoff);
    await mkdir(dir, { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(tmp, path);
  }

  /** Serializes read-modify-write so two webhooks never interleave. */
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    nextNumber() {
      return locked(async () => {
        const file = await load();
        file.lastNumber += 1;
        await store(file, new Date());
        return file.lastNumber;
      });
    },
    save(record) {
      return locked(async () => {
        const file = await load();
        const index = file.tickets.findIndex((t) => t.number === record.number);
        if (index >= 0) {
          file.tickets[index] = record;
        } else {
          file.tickets.push(record);
        }
        await store(file, new Date());
      });
    },
    findByMessageId(messageId) {
      return locked(async () => (await load()).tickets.find((t) => t.messageId === messageId));
    },
    hasReply(replyMessageId) {
      return locked(async () =>
        (await load()).tickets.some((t) => t.confirmation?.replyMessageId === replyMessageId),
      );
    },
  };
}

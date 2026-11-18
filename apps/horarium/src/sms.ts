// Text messages through the clinic's Yeastar TG200 GSM gateway (SIM cards in the clinic), over its
// TCP API (port 5038, enabled in the gateway's web panel under the API settings). One connection per
// message: log in, send, wait for the gateway's delivery report, log off.
import net from "node:net";

export interface SmsResult {
  sent: boolean;
  /** Why it was not sent, in Polish, for reception. */
  reason?: string;
}

export type SendSms = (to: string, text: string) => Promise<SmsResult>;

export interface Tg200Config {
  host: string;
  port: number;
  username: string;
  secret: string;
  /** The gateway's GSM span the message goes out of (the SIM slot as the API counts it). */
  span: number;
  /** Optional allowlist (E.164). When set, only these numbers get texts: for the demo preview. */
  onlyTo: string[] | null;
  /** The demo preview sets this: with no allowlist nothing is sent, so made-up patients never get texts. */
  requireAllowlist: boolean;
  timeoutMs: number;
}

/** Reads TG200_* from the environment; null when SMS is not configured. */
export function tg200FromEnv(env: NodeJS.ProcessEnv = process.env): Tg200Config | null {
  if (!env.TG200_HOST || !env.TG200_USERNAME || !env.TG200_SECRET) return null;
  const onlyTo = (env.TG200_ONLY_TO ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return {
    host: env.TG200_HOST,
    username: env.TG200_USERNAME,
    secret: env.TG200_SECRET,
    port: Number(env.TG200_PORT || 5038),
    span: Number(env.TG200_SPAN || 2),
    onlyTo: onlyTo.length ? onlyTo : null,
    requireAllowlist: env.SMS_REQUIRE_ALLOWLIST === "1",
    timeoutMs: Number(env.TG200_TIMEOUT_MS || 20_000),
  };
}

/** The message as the gateway's "gsm send sms" command takes it: one line, quotes and backslashes escaped. */
const dayFmt = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" });

/**
 * The text a patient gets after their visit is moved. A first proposal, to be agreed with the clinic
 * before go-live (wording, the clinic's phone number).
 */
export function movedVisitText(startsAt: Date, siteName: string): string {
  return `DentaPlus+: Państwa wizyta została przeniesiona na ${dayFmt.format(startsAt)} godz. ${timeFmt.format(startsAt)}, ${siteName}. W razie pytań prosimy o kontakt z rejestracją.`;
}

export function smsCommand(span: number, to: string, text: string, id: string): string {
  const body = text.replace(/\r?\n/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `gsm send sms ${span} ${to} "${body}" ${id}`;
}

/** Splits the API's reply stream into "Key: value" blocks separated by a blank line. */
export function parseBlocks(buffer: string): { blocks: Record<string, string>[]; rest: string } {
  const parts = buffer.split("\r\n\r\n");
  const rest = parts.pop() ?? "";
  const blocks = parts.map((part) => {
    const block: Record<string, string> = {};
    for (const line of part.split("\r\n")) {
      const i = line.indexOf(":");
      if (i > 0) block[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return block;
  });
  return { blocks, rest };
}

export function createTg200Sender(config: Tg200Config): SendSms {
  return (to, text) =>
    new Promise((resolve) => {
      if (config.requireAllowlist && !config.onlyTo) {
        resolve({ sent: false, reason: "w podglądzie SMS-y idą tylko na numery z listy testowej, a lista jest pusta" });
        return;
      }
      if (config.onlyTo && !config.onlyTo.includes(to)) {
        resolve({ sent: false, reason: "ten numer nie jest na liście testowej (TG200_ONLY_TO)" });
        return;
      }
      const id = String(Date.now() % 1_000_000_000);
      const socket = net.connect({ host: config.host, port: config.port });
      let buffer = "";
      let stage: "login" | "send" | "report" = "login";
      let done = false;
      const finish = (result: SmsResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.end("Action: Logoff\r\n\r\n");
        resolve(result);
      };
      const timer = setTimeout(() => finish({ sent: false, reason: "bramka SMS nie odpowiedziała na czas" }), config.timeoutMs);
      socket.setEncoding("utf8");
      socket.on("error", () => finish({ sent: false, reason: "brak połączenia z bramką SMS" }));
      socket.on("connect", () => {
        socket.write(`Action: Login\r\nUsername: ${config.username}\r\nSecret: ${config.secret}\r\n\r\n`);
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const { blocks, rest } = parseBlocks(buffer);
        buffer = rest;
        for (const b of blocks) {
          if (stage === "login" && b.Response) {
            if (b.Response !== "Success") return finish({ sent: false, reason: "bramka SMS odrzuciła logowanie" });
            stage = "send";
            socket.write(`Action: smscommand\r\ncommand: ${smsCommand(config.span, to, text, id)}\r\n\r\n`);
            stage = "report";
          } else if (stage === "report" && b.Event === "UpdateSMS" && (b.ID === id || b.Id === id)) {
            // Status 1 is a successful send; anything else is a failure reported by the network.
            return finish(b.Status === "1" ? { sent: true } : { sent: false, reason: `bramka SMS zgłosiła błąd (status ${b.Status ?? "?"})` });
          } else if (stage === "report" && b.Response === "Error") {
            return finish({ sent: false, reason: `bramka SMS odrzuciła wiadomość${b.Message ? `: ${b.Message}` : ""}` });
          }
        }
      });
    });
}

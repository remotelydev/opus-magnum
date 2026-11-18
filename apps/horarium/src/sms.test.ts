import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { createTg200Sender, movedVisitText, parseBlocks, smsCommand, tg200FromEnv, type Tg200Config } from "./sms.js";

test("the moved-visit text names the new day, time and clinic in clinic time", () => {
  assert.equal(
    movedVisitText(new Date("2026-11-20T09:00:00Z"), "Turek"),
    "DentaPlus+: Państwa wizyta została przeniesiona na 20.11.2026 godz. 10:00, Turek. W razie pytań prosimy o kontakt z rejestracją.",
  );
});

test("smsCommand keeps the message on one line and escapes quotes", () => {
  assert.equal(
    smsCommand(2, "+48600100200", 'Wizyta "jutro"\no 10:00', "7"),
    'gsm send sms 2 +48600100200 "Wizyta \\"jutro\\" o 10:00" 7',
  );
});

test("parseBlocks reads Key: value blocks and keeps an unfinished one for later", () => {
  const { blocks, rest } = parseBlocks("Response: Success\r\nMessage: ok\r\n\r\nEvent: Upd");
  assert.deepEqual(blocks, [{ Response: "Success", Message: "ok" }]);
  assert.equal(rest, "Event: Upd");
});

test("no TG200_* in the environment: SMS is off", () => {
  assert.equal(tg200FromEnv({}), null);
  assert.deepEqual(tg200FromEnv({ TG200_HOST: "h", TG200_USERNAME: "u", TG200_SECRET: "s", TG200_ONLY_TO: "+48600100200" })?.onlyTo, [
    "+48600100200",
  ]);
});

/** A stand-in gateway: accepts the login, answers the send with a delivery report. */
async function fakeGateway(status: string) {
  const seen: string[] = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      seen.push(chunk);
      if (chunk.startsWith("Action: Login")) socket.write("Response: Success\r\nMessage: Authentication accepted\r\n\r\n");
      const id = chunk.match(/gsm send sms \d+ \S+ ".*" (\d+)/)?.[1];
      if (id) {
        socket.write("Response: Follows\r\nPrivilege: Command\r\n--END COMMAND--\r\n\r\n");
        socket.write(`Event: UpdateSMS\r\nPrivilege: all,smscommand\r\nID: ${id}\r\nSmsc: +48000\r\nStatus: ${status}\r\n\r\n`);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  const config: Tg200Config = {
    host: "127.0.0.1",
    port,
    username: "api",
    secret: "pw",
    span: 2,
    onlyTo: null,
    requireAllowlist: false,
    timeoutMs: 2000,
  };
  return { server, seen, config };
}

test("sender logs in, sends and reads the delivery report", async () => {
  const { server, seen, config } = await fakeGateway("1");
  try {
    assert.deepEqual(await createTg200Sender(config)("+48600100200", "Test"), { sent: true });
    assert.match(seen.join(""), /Username: api\r\nSecret: pw/);
    assert.match(seen.join(""), /command: gsm send sms 2 \+48600100200 "Test" \d+/);
  } finally {
    server.close();
  }
});

test("sender reports a failed delivery, and refuses numbers off the test list", async () => {
  const { server, config } = await fakeGateway("0");
  try {
    assert.equal((await createTg200Sender(config)("+48600100200", "Test")).sent, false);
    const limited = await createTg200Sender({ ...config, onlyTo: ["+48111222333"] })("+48600100200", "Test");
    assert.equal(limited.sent, false);
    assert.match(limited.reason!, /liście testowej/);
    const preview = await createTg200Sender({ ...config, requireAllowlist: true })("+48600100200", "Test");
    assert.equal(preview.sent, false);
  } finally {
    server.close();
  }
});

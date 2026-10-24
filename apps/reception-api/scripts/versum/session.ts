// Interactive Versum session: opens a headed Chrome, you log in yourself,
// and a small control server on 127.0.0.1 lets the exporter (and exploring)
// reuse that live session. Nothing about the session is written to disk:
// the browser profile is a throwaway and cookies are never saved.
//
//   pnpm --filter reception-api versum:session   # stays open, control server
//   pnpm --filter reception-api versum:export    # waits for login, exports, exits
//
// Read-only guard: once armed (POST /arm, or automatically by /export),
// every non-GET request from the page is aborted and logged.
import { createServer } from "node:http";
import { chromium, type Page, type Request } from "playwright";
import { maskPath, shape, throttle, type Shape } from "./lib.js";

const START_URL = process.env.VERSUM_URL?.trim() || "https://panel.versum.com/";
const PORT = Number(process.env.VERSUM_CONTROL_PORT || 47123);

const browser = await chromium.launch({ headless: false, channel: "chrome" });
const context = await browser.newContext({ locale: "pl-PL", timezoneId: "Europe/Warsaw" });
const page = await context.newPage();
const gap = throttle();

let armed = false;
const blocked = new Map<string, number>();
type Seen = { method: string; host: string; path: string; status: number; count: number; shape?: Shape };
const seen = new Map<string, Seen>();

await context.route("**/*", (route) => {
  const req = route.request();
  if (armed && !["GET", "HEAD", "OPTIONS"].includes(req.method())) {
    const key = `${req.method()} ${maskPath(req.url())}`;
    blocked.set(key, (blocked.get(key) ?? 0) + 1);
    return route.abort("blockedbyclient");
  }
  return route.continue();
});

context.on("response", async (res) => {
  const req: Request = res.request();
  const type = res.headers()["content-type"] ?? "";
  if (!["xhr", "fetch"].includes(req.resourceType()) && !type.includes("json")) return;
  const u = new URL(req.url());
  const key = `${req.method()} ${u.host}${maskPath(req.url())}`;
  const entry = seen.get(key) ?? { method: req.method(), host: u.host, path: maskPath(req.url()), status: 0, count: 0 };
  entry.status = res.status();
  entry.count++;
  if (type.includes("json")) entry.shape = await res.json().then(shape, () => "unparsable json");
  seen.set(key, entry);
});

await page.goto(START_URL);
console.log(`Versum window open. Log in there. Control: http://127.0.0.1:${PORT}`);

/** Outline of the current page without any free text from its content. */
async function outline(p: Page) {
  return p.evaluate(() => {
    const nav = [...document.querySelectorAll("nav a, header a, aside a, [role=navigation] a, .menu a, .sidebar a")]
      .map((a) => ({ text: (a.textContent ?? "").trim().slice(0, 40), href: (a as HTMLAnchorElement).href }))
      // links into a person's card would carry their name as text
      .map((n) => (/customer|client|patient|pacjen|klien/i.test(n.href) ? { ...n, text: "(person link)" } : n));
    const th = [...document.querySelectorAll("th")].map((t) => (t.textContent ?? "").trim().slice(0, 40));
    const forms = [...document.forms].map((f) => ({
      action: f.action,
      method: f.method,
      inputs: [...f.elements].map((e) => (e as HTMLInputElement).name).filter(Boolean),
    }));
    const selects = [...document.querySelectorAll("select")].map((s) => ({ name: s.name || s.id, options: s.options.length }));
    const dataAttrs = new Map<string, number>();
    for (const el of document.querySelectorAll("*"))
      for (const a of el.getAttributeNames())
        if (a.startsWith("data-")) dataAttrs.set(a, (dataAttrs.get(a) ?? 0) + 1);
    const scripts = [...document.scripts].map((s) => s.src).filter(Boolean);
    const globals = Object.keys(window).filter((k) => /^[A-Z_]|app|config|gon|state/i.test(k)).slice(0, 80);
    return { nav, th, forms, selects, dataAttrs: Object.fromEntries(dataAttrs), scripts, globals };
  }).then((o) => ({
    ...o,
    nav: o.nav.map((n) => ({ text: n.text, href: n.href.startsWith("http") ? maskPath(n.href) : n.href })),
    forms: o.forms.map((f) => ({ ...f, action: f.action ? maskPath(f.action) : "" })),
    scripts: o.scripts.map((s) => maskPath(s)),
  }));
}

/** GET through the page so the app's own cookies apply. Returns shape only. */
export async function getJson(p: Page, url: string): Promise<{ status: number; type: string; body: unknown }> {
  await gap();
  return p.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "include", headers: { accept: "application/json, text/javascript, */*" } });
    const type = r.headers.get("content-type") ?? "";
    const text = await r.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = { html: text.length }; }
    return { status: r.status, type, body };
  }, url);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body, null, 1));
  };
  try {
    const current = context.pages().at(-1) ?? page;
    switch (url.pathname) {
      case "/status":
        return send(200, { armed, pages: context.pages().map((p) => (p.url().startsWith("http") ? `${new URL(p.url()).host}${maskPath(p.url())}` : p.url())) });
      case "/arm":
        armed = true;
        return send(200, { armed });
      case "/log":
        return send(200, { seen: [...seen.values()], blocked: Object.fromEntries(blocked) });
      case "/goto": {
        await gap();
        const r = await current.goto(url.searchParams.get("url")!, { waitUntil: "networkidle" });
        return send(200, { status: r?.status(), at: maskPath(current.url()) });
      }
      case "/dom":
        return send(200, await outline(current));
      case "/fetch": {
        armed = true;
        const target = new URL(url.searchParams.get("url")!, current.url()).toString();
        const r = await getJson(current, target);
        return send(200, { status: r.status, type: r.type, shape: shape(r.body) });
      }
      case "/export": {
        armed = true;
        const mod = await import(`./export.ts?v=${Date.now()}`); // re-read on every call
        return send(200, await mod.runExport(current));
      }
      case "/quit":
        send(200, { bye: true });
        await browser.close();
        process.exit(0);
      default:
        return send(404, { endpoints: ["/status", "/arm", "/log", "/goto?url=", "/dom", "/fetch?url=", "/export", "/quit"] });
    }
  } catch (err) {
    return send(500, { error: String((err as Error).message).slice(0, 300) });
  }
});
if (process.argv.includes("--once")) {
  // Logged in once the URL is the account panel (/<account>/...), not /signin.
  const deadline = Date.now() + 10 * 60_000;
  while (!/^\/(?!signin\b)[0-9a-z]+(\/|$)/.test(new URL(page.url()).pathname) || new URL(page.url()).host !== "panel.versum.com") {
    if (Date.now() > deadline) {
      console.error("No Versum login within 10 minutes.");
      await browser.close();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  armed = true;
  await page.waitForLoadState("networkidle");
  const { runExport } = await import("./export.js");
  const result = await runExport(page);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
}

server.listen(PORT, "127.0.0.1");

browser.on("disconnected", () => process.exit(0));

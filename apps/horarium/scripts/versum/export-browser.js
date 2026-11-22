// Versum → file export of the visit history, run inside a logged-in Versum panel tab
// (panel.versum.com/<account>/...). Versum has no export API, so this reads the same JSON and pages the
// panel itself loads, only systematically:
//
//   calendar  /events/?format=json&user_ids[]=…&start=…&end=…  – every visit that is still in the
//             calendar (booked, finalised, "odwołano"-tagged), with the description, payments and tags.
//             One request covers all staff for two weeks, so the whole history is a few hundred requests.
//   history   /<account>/customers/<id>?tab_name=events_history&page=N  – a patient's visit list. Only
//             needed for what the calendar leaves out: deleted visits ("usunięto") and visits of former
//             staff. Run for the patients listed in `opts.patients` (or all, which is slow: 10 per page).
//   details   /events/<id>/screen_data  – the full JSON of one visit; fetched for visits found in the
//             history but not in the calendar. Optional /<account>/events/<id>/versions (change history).
//
// Versum rate-limits an account to roughly 50 requests a minute and answers 429 after that, so this runs
// one request at a time, 1.3 s apart, and on a 429 waits 1 min, then 2, 4 … up to 15 min.
// Everything is kept raw in IndexedDB ("versum-visits-export") so a stop resumes where it left off.
// `vx.download()` saves NDJSON files to the Mac's Downloads folder. Patient data never leaves the Mac.
//
// Console:  vx.start({ from: "2017-01-01", to: "2028-12-31" })   vx.status()   vx.pause()   vx.download()
//           vx.start({ phases: ["history", "details"], patients: ["123", "456"], versions: true })
(() => {
  if (window.vx) return;
  const ACCOUNT = location.pathname.split("/")[1];
  const DB_NAME = "versum-visits-export";
  const JSON_HEADERS = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };
  const GAP_MS = 1300;
  const CALENDAR_DAYS = 14;

  const state = { running: false, phase: "idle", error: null, waitingUntil: null, opts: {}, counters: {} };
  const bump = (k, n = 1) => (state.counters[k] = (state.counters[k] || 0) + n);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- IndexedDB -----------------------------------------------------------------------------------
  let dbp;
  function db() {
    dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const name of ["meta", "patients", "events", "ranges"]) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  const req2p = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      let out;
      Promise.resolve(fn(t.objectStore(store))).then((v) => (out = v));
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  }
  const get = (store, key) => tx(store, "readonly", (s) => req2p(s.get(key)));
  const put = (store, key, value) => tx(store, "readwrite", (s) => s.put(value, key));
  const getAll = (store) => tx(store, "readonly", (s) => req2p(s.getAll()));
  const count = (store) => tx(store, "readonly", (s) => req2p(s.count()));

  /** Merge fields into stored visits, keyed by Versum event id. */
  const mergeEvents = (items) =>
    tx("events", "readwrite", async (s) => {
      for (const it of items) {
        const old = (await req2p(s.get(it.id))) || {};
        s.put({ ...old, ...it }, it.id);
      }
    });

  // ---- HTTP: one at a time, with a 429 back-off -----------------------------------------------------
  let lastAt = 0;
  async function fetchText(url, opts = {}) {
    let wait429 = 60000;
    for (let attempt = 0; ; attempt++) {
      if (!state.running) throw new Error("paused");
      const gap = lastAt + GAP_MS - Date.now();
      if (gap > 0) await sleep(gap);
      lastAt = Date.now();
      let r;
      try {
        r = await fetch(url, { credentials: "same-origin", ...opts });
      } catch (e) {
        bump("network_errors");
        if (attempt >= 8) throw e;
        await sleep(10000);
        continue;
      }
      bump("requests");
      if (r.url.includes("/signin")) throw Object.assign(new Error("logged out of Versum"), { fatal: true });
      if (r.status === 429) {
        bump("rate_limited");
        state.waitingUntil = new Date(Date.now() + wait429).toISOString();
        await sleep(wait429);
        state.waitingUntil = null;
        wait429 = Math.min(wait429 * 2, 15 * 60000);
        continue;
      }
      if (r.status === 404) return null;
      if (r.status >= 500) {
        bump("server_errors");
        if (attempt >= 8) throw new Error(`HTTP ${r.status} for ${url}`);
        await sleep(15000);
        continue;
      }
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { fatal: true });
      return r.text();
    }
  }
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");

  // ---- staff list (from any patient's history tab, which embeds all of them) ------------------------
  async function staff() {
    let emps = await get("meta", "employees");
    if (!emps) {
      const html = await fetchText(`/${ACCOUNT}/customers?size=10&page=1`);
      const id = [...parse(html).querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href").match(new RegExp(`^/${ACCOUNT}/customers/(\\d+)$`)))
        .find((m) => m && m[1] !== "0")[1];
      const td = parse(await fetchText(`/${ACCOUNT}/customers/${id}?tab_name=events_history`)).querySelector("td[data-all-employees]");
      emps = td.dataset.allEmployees;
      await put("meta", "employees", emps);
      await put("meta", "tags", td.dataset.tags);
    }
    const extra = (await get("meta", "extra_employee_ids")) || [];
    return [...new Set([...JSON.parse(emps).map((e) => String(e.id)), ...extra.map(String)])];
  }

  // ---- phase: calendar --------------------------------------------------------------------------------
  async function calendar() {
    state.phase = "calendar";
    const ids = await staff();
    const q = ids.map((id) => `user_ids%5B%5D=${id}`).join("&");
    const from = new Date(`${state.opts.from || "2017-01-01"}T00:00:00Z`);
    const to = new Date(`${state.opts.to || "2028-12-31"}T00:00:00Z`);
    const day = (d) => d.toISOString().slice(0, 10);
    for (let s = from; s <= to; s = new Date(s.getTime() + CALENDAR_DAYS * 864e5)) {
      if (!state.running) return;
      const e = new Date(Math.min(s.getTime() + CALENDAR_DAYS * 864e5, to.getTime() + 864e5));
      const key = `${day(s)}_${day(e)}_${ids.length}`;
      if (await get("ranges", key)) continue;
      const text = await fetchText(`/events/?format=json&${q}&start=${day(s)}&end=${day(e)}`, { headers: JSON_HEADERS });
      const items = JSON.parse(text || "[]");
      // One entry per visit service; group them back into visits.
      const byEvent = new Map();
      for (const it of items) {
        const id = String(it.event_id ?? it.groupId ?? it.id);
        if (!byEvent.has(id)) byEvent.set(id, []);
        byEvent.get(id).push(it);
      }
      await mergeEvents([...byEvent].map(([id, parts]) => ({ id, patient_id: parts[0].customer_id ? String(parts[0].customer_id) : null, calendar: parts })));
      await put("ranges", key, { n: items.length, at: new Date().toISOString() });
      bump("calendar_ranges");
      bump("calendar_visits", byEvent.size);
    }
  }

  // ---- phase: patient history pages -------------------------------------------------------------------
  async function history() {
    state.phase = "history";
    let ids = state.opts.patients?.map(String);
    if (!ids) {
      // All patients: build the list first (100 per page).
      let page = (await get("meta", "list_next_page")) || 1;
      for (;;) {
        if (!state.running) return;
        if (await get("meta", "list_done")) break;
        const d = parse(await fetchText(`/${ACCOUNT}/customers?size=100&page=${page}`));
        const found = [...d.querySelectorAll("a[href]")]
          .map((a) => a.getAttribute("href").match(new RegExp(`^/${ACCOUNT}/customers/(\\d+)$`)))
          .filter((m) => m && m[1] !== "0")
          .map((m) => m[1]);
        if (!found.length) await put("meta", "list_done", true);
        await tx("patients", "readwrite", async (s) => {
          for (const id of found) if (!(await req2p(s.get(id)))) s.put({ id, done: false }, id);
        });
        await put("meta", "list_next_page", ++page);
      }
      ids = (await getAll("patients")).map((p) => p.id);
    }
    for (const id of ids) {
      if (!state.running) return;
      const p = (await get("patients", id)) || { id };
      if (p.done) continue;
      const rows = [];
      for (let page = 1; page < 500; page++) {
        const html = await fetchText(`/${ACCOUNT}/customers/${id}?tab_name=events_history&page=${page}`);
        if (html === null) break;
        const found = [...parse(html).querySelectorAll("tr.basic_info[data-event_id]")].map((r) => ({
          id: r.dataset.event_id,
          patient_id: id,
          history_row: {
            cls: r.className,
            status: r.querySelector(".event-status span")?.title || null,
            staff: [...r.querySelectorAll("a.employee-tag")].map((a) => ({
              id: (a.getAttribute("href") || "").split("/").pop(),
              name: a.getAttribute("title") || a.getAttribute("data-original-title"),
            })),
          },
        }));
        rows.push(...found);
        if (found.length < 10) break;
      }
      await mergeEvents(rows);
      await put("patients", id, { ...p, done: true, events: rows.map((r) => r.id) });
      bump("patients_done");
      bump("history_visits", rows.length);
    }
  }

  // ---- phase: visit details for what the calendar did not return --------------------------------------
  async function details() {
    state.phase = "details";
    const events = await getAll("events");
    const todo = events.filter((e) => (!e.calendar && !e.screen) || (state.opts.versions && e.versions === undefined));
    state.counters.details_todo = todo.length;
    for (const e of todo) {
      if (!state.running) return;
      const item = { id: e.id };
      if (!e.calendar && !e.screen) {
        const t = await fetchText(`/events/${e.id}/screen_data`, { headers: JSON_HEADERS });
        item.screen = t === null ? { missing: true } : JSON.parse(t);
      }
      if (state.opts.versions && e.versions === undefined) {
        item.versions = await fetchText(`/${ACCOUNT}/events/${e.id}/versions`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
      }
      await mergeEvents([item]);
      bump("details_done");
    }
  }

  const PHASES = { calendar, history, details };
  async function run() {
    try {
      for (const name of state.opts.phases || ["calendar"]) {
        await PHASES[name]();
        if (!state.running) return;
      }
      state.phase = "finished";
    } catch (e) {
      if (e.message !== "paused") state.error = e.message;
    } finally {
      state.running = false;
    }
  }

  // ---- files ------------------------------------------------------------------------------------------
  function save(name, parts) {
    const url = URL.createObjectURL(new Blob(parts, { type: "application/x-ndjson" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  async function download({ chunkMb = 100 } = {}) {
    const stamp = new Date().toISOString().slice(0, 10);
    const events = await getAll("events");
    const meta = {
      exported_at: new Date().toISOString(),
      account: ACCOUNT,
      employees: JSON.parse((await get("meta", "employees")) || "[]"),
      tags: JSON.parse((await get("meta", "tags")) || "[]"),
      counters: state.counters,
      events: events.length,
    };
    save(`versum-visits-${stamp}-meta.json`, [JSON.stringify(meta, null, 1)]);
    let part = 1, parts = [], size = 0;
    const flush = async () => {
      save(`versum-visits-${stamp}-events-${String(part++).padStart(3, "0")}.ndjson`, parts);
      parts = [];
      size = 0;
      await sleep(1500);
    };
    for (const e of events) {
      const line = JSON.stringify(e) + "\n";
      parts.push(line);
      size += line.length;
      if (size > chunkMb * 1e6) await flush();
    }
    if (parts.length) await flush();
    return { files: part, events: events.length };
  }

  window.vx = {
    start(opts = {}) {
      if (state.running) return "already running";
      Object.assign(state, { running: true, error: null, opts, startedAt: new Date().toISOString() });
      run();
      return "started";
    },
    pause() {
      state.running = false;
      return "pausing";
    },
    async status() {
      return { ...state, stored: { events: await count("events"), patients: await count("patients"), ranges: await count("ranges") } };
    },
    /** Visits per staff id and how many lack a description, without reading any patient content. */
    async summary() {
      const events = await getAll("events");
      const staffCount = {};
      let deleted = 0, withHistoryOnly = 0;
      for (const e of events) {
        const ids = e.calendar ? e.calendar.flatMap((c) => c.entities?.map((x) => x.id) || []) : e.screen?.events?.[0]?.services?.flatMap((s) => s.employee_ids) || e.history_row?.staff.map((s) => s.id) || [];
        for (const id of new Set(ids.map(String))) staffCount[id] = (staffCount[id] || 0) + 1;
        if (e.screen?.events?.[0]?.deleted_at || /deleted/.test(e.history_row?.cls || "")) deleted++;
        if (!e.calendar) withHistoryOnly++;
      }
      return { events: events.length, deleted, withHistoryOnly, staffCount };
    },
    /** Former staff found in histories can be added so the calendar phase covers them too. */
    async addStaff(ids) {
      const old = (await get("meta", "extra_employee_ids")) || [];
      await put("meta", "extra_employee_ids", [...new Set([...old, ...ids.map(String)])]);
      return "ok";
    },
    download,
    async reset() {
      if (state.running) return "pause first";
      (await db()).close();
      dbp = undefined;
      await req2p(indexedDB.deleteDatabase(DB_NAME));
      state.counters = {};
      return "cleared";
    },
  };
})();

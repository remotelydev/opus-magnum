// Versum card extras: dental diagram history, photo gallery and attached files, per patient.
//
// Paste into the console of a logged-in panel.versum.com tab after extract-patients.js has run there
// (it reuses the patient id list saved in localStorage under "versum-export-ids").
//
//   versumExtras.run()       walk every patient (resumes where it stopped), 3 requests per patient
//   versumExtras.status()    progress and counts
//   versumExtras.download()  save versum-dodatki-YYYY-MM-DD.ndjson (only patients that have something)
//   versumExtras.stop()
//
// Only patients with a non-empty tab are stored: { id, dental: [...] | null, gallery: html | null,
// files: html | null }. The file never leaves the computer it is downloaded on.
(() => {
  const BASE = location.pathname.match(/^\/[^/]+/)[0];
  const DB_NAME = "versum-extras-export";
  const STORE = "extras";
  const POS_KEY = "versum-extras-pos";
  let GAP_MS = 1200;
  let last = 0;
  const state = { running: false, stop: false, checked: 0, found: 0, errors: [], phase: "idle" };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function slot() {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  }

  async function get(url, json) {
    let backoff = 60_000;
    for (;;) {
      await slot();
      const res = await fetch(url, json ? { headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" } } : {});
      if (res.status === 429) {
        state.phase = `429, waiting ${backoff / 1000}s`;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 15 * 60_000);
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (res.url.includes("/signin") || res.url.includes("/login")) throw new Error("logged out");
      return json ? res.json() : res.text();
    }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function put(rec) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
  async function all() {
    const db = await openDb();
    const rows = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  }

  /** The tab's HTML when it holds something, else null. Unknown layouts are kept, to be safe. */
  function tabContent(html, paneId, itemsSelector) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const pane = doc.getElementById(paneId);
    if (!pane) return `<!-- no #${paneId} -->` + (doc.querySelector("#pjax_container")?.innerHTML ?? "");
    const empty = pane.querySelector("#no_files_info");
    const items = pane.querySelector(itemsSelector);
    const hasItems = items && items.querySelector("img, a[href], tbody tr, li, td");
    const emptyShown = empty && !/display:\s*none/.test(empty.getAttribute("style") || "");
    if (!hasItems && emptyShown) return null;
    return pane.innerHTML;
  }

  async function checkPatient(id) {
    const dental = await get(`${BASE}/customers/${id}/dental_history`, true);
    const gallery = await get(`${BASE}/customers/${id}?tab_name=gallery`, false);
    const files = await get(`${BASE}/customers/${id}?tab_name=files`, false);
    const rec = {
      id,
      dental: Array.isArray(dental) && dental.length ? dental : null,
      gallery: gallery ? tabContent(gallery, "gallery", "#photo_container") : null,
      files: files ? tabContent(files, "files", "#files_table") : null,
      fetchedAt: new Date().toISOString(),
    };
    if (rec.dental || rec.gallery || rec.files) {
      await put(rec);
      state.found++;
    }
  }

  async function run() {
    if (state.running) return "already running";
    const ids = JSON.parse(localStorage.getItem("versum-export-ids") || "[]");
    if (!ids.length) throw new Error("no patient ids: run extract-patients.js first");
    state.running = true;
    state.stop = false;
    state.found = (await all()).length;
    let pos = Number(localStorage.getItem(POS_KEY) || 0);
    try {
      while (pos < ids.length && !state.stop) {
        state.phase = "checking";
        try {
          await checkPatient(String(ids[pos]));
        } catch (error) {
          if (error.message === "logged out") throw error;
          state.errors.push({ id: String(ids[pos]), error: error.message });
        }
        pos++;
        state.checked = pos;
        localStorage.setItem(POS_KEY, String(pos));
      }
      state.phase = state.stop ? "stopped" : "finished";
    } catch (error) {
      state.phase = `error: ${error.message}`;
    } finally {
      state.running = false;
    }
    return state.phase;
  }

  async function retryErrors() {
    const failed = state.errors.splice(0);
    for (const { id } of failed) {
      try {
        await checkPatient(id);
      } catch (error) {
        state.errors.push({ id, error: error.message });
      }
    }
    return { retried: failed.length, stillFailing: state.errors.length };
  }

  async function download() {
    const rows = await all();
    const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const file = `versum-dodatki-${new Date().toISOString().slice(0, 10)}.ndjson`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
    a.download = file;
    a.click();
    return { records: rows.length, bytes: text.length, file };
  }

  function status() {
    const total = JSON.parse(localStorage.getItem("versum-export-ids") || "[]").length;
    return { phase: state.phase, running: state.running, checked: state.checked || Number(localStorage.getItem(POS_KEY) || 0),
      total, found: state.found, errors: state.errors.length, lastErrors: state.errors.slice(-3), gapMs: GAP_MS };
  }

  /** Counts per kind, no patient data. */
  async function summary() {
    const rows = await all();
    return { patients: rows.length, dental: rows.filter((r) => r.dental).length,
      gallery: rows.filter((r) => r.gallery).length, files: rows.filter((r) => r.files).length };
  }

  window.versumExtras = { run, status, summary, download, retryErrors, checkPatient,
    stop: () => { state.stop = true; }, setGap: (ms) => { GAP_MS = ms; } };
})();

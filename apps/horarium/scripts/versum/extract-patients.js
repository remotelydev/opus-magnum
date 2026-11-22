// Versum patient export, run inside a logged-in Versum panel tab (panel.versum.com).
//
// Reads every patient card (edit form + "dane osobowe" tab) and keeps each record in this browser's
// IndexedDB, so a reload or a closed laptop only pauses it: run it again and it carries on. Nothing
// leaves the browser until `versumPatients.download()` saves one NDJSON file (one patient per line)
// to the Mac's Downloads folder. The file holds personal and health data: it never goes into the
// repository or the cloud; it is imported on the clinic machine with `pnpm --filter horarium
// import:versum-patients <file>`.
//
// Read-only: only GET requests to pages a user can open anyway.
(() => {
  const DB_NAME = "versum-export";
  const STORE = "patients";
  const PAGE_SIZE = 100;
  // Versum answers 429 (Too Many Requests) and locks the account for a while when pushed: in Nov 2026
  // four parallel requests (~5 per second) tripped it within minutes. So one request at a time, at
  // least GAP_MS apart, and on a 429 everything pauses, longer each time.
  const GAP_MS = 1200;
  const salon = location.pathname.split("/")[1] || document.querySelector('a[href$="/customers"]')?.getAttribute("href").split("/")[1];
  if (!salon || !/^[0-9a-f]{6,}$/.test(salon)) throw new Error("Open the Versum panel first (panel.versum.com/<salon>/...).");

  const idb = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const tx = async (mode, fn) => {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out?.result ?? out);
      t.onerror = () => reject(t.error);
    });
  };
  const allKeys = () => tx("readonly", (s) => s.getAllKeys());
  const allRecords = () => tx("readonly", (s) => s.getAll());
  const put = (rec) => tx("readwrite", (s) => s.put(rec));

  const state = { running: false, stop: false, total: 0, done: 0, errors: [], phase: "idle" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let nextSlot = 0;
  let backoff = 0;
  async function page(url) {
    for (let attempt = 1; ; attempt++) {
      const wait = nextSlot - Date.now();
      nextSlot = Math.max(Date.now(), nextSlot) + GAP_MS;
      if (wait > 0) await sleep(wait);
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        backoff = 0;
        return new DOMParser().parseFromString(await res.text(), "text/html");
      }
      if (res.status === 404) return null;
      if (res.status === 429) {
        backoff = Math.min(backoff ? backoff * 2 : 60_000, 15 * 60_000);
        state.phase = `paused by Versum (429), retry in ${Math.round(backoff / 1000)} s`;
        nextSlot = Date.now() + backoff;
        if (state.stop) throw new Error("stopped");
        continue;
      }
      if (attempt >= 5) throw new Error(`${res.status} ${url}`);
      await sleep(2000 * attempt);
    }
  }

  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

  /** Every field of the edit form, as Versum names it (minus tokens), plus the labels of selects. */
  function formFields(doc) {
    const form = [...doc.querySelectorAll("form")].find((f) => /\/customers\/\d+$/.test(f.getAttribute("action") || ""));
    if (!form) throw new Error("edit form not found (logged out?)");
    const fields = {};
    const labels = {};
    const add = (key, value) => {
      if (key.endsWith("[]")) (fields[key] ||= []).push(value);
      else fields[key] = value;
    };
    for (const el of form.elements) {
      const name = el.name;
      if (!name || /authenticity_token|utf8|_method|^commit$|profile_photo/.test(name)) continue;
      const key = name.replace(/^physical_customers_glaxo\[([^\]]+)\](\[\])?$/, (_, k, arr) => k + (arr || ""));
      if (el.type === "checkbox") {
        if (key.endsWith("[]")) {
          if (el.checked) add(key, el.value);
        } else fields[key] = el.checked;
      } else if (el.type === "radio") {
        if (el.checked) fields[key] = el.value;
      } else if (el.tagName === "SELECT") {
        const picked = [...el.selectedOptions].filter((o) => o.value !== "");
        if (el.multiple) {
          fields[key] = picked.map((o) => o.value);
          labels[key] = picked.map((o) => clean(o.text));
        } else {
          fields[key] = picked[0]?.value ?? "";
          if (picked[0]) labels[key] = clean(picked[0].text);
        }
      } else if (el.type === "hidden" && key in fields) {
        continue; // Rails' hidden "0" before a checkbox
      } else if (el.type === "hidden" && key.endsWith("[]")) {
        if (el.value) add(key, el.value);
      } else {
        add(key, el.value ?? "");
      }
    }
    // Consents by Versum content id. A hidden one is the notice every patient gets (no checkbox);
    // a checkbox is an optional consent. The wording of each id is the same for every patient.
    const agreements = {};
    form.querySelectorAll('[name$="[agreements_accepted_content_ids][]"]').forEach((el) => {
      if (el.value) agreements[el.value] = el.type === "hidden" ? "notice" : el.checked;
    });
    return { fields, labels, agreements };
  }

  /** "dane osobowe" tab: label/value pairs as shown, including "Data dodania" and "Ostatnia modyfikacja". */
  function shownData(doc) {
    const out = {};
    doc.querySelectorAll("dl").forEach((dl) => {
      let label = null;
      for (const el of dl.children) {
        if (el.tagName === "DT") label = clean(el.textContent);
        else if (el.tagName === "DD" && label) out[label] = clean(el.textContent);
      }
    });
    if (Object.keys(out).length === 0) {
      // Fallback for a layout without <dl>: alternate lines of the main column.
      const lines = (doc.querySelector("#pjax_container") || doc.body).innerText.split("\n").map(clean).filter(Boolean);
      const want = ["Data dodania", "Ostatnia modyfikacja", "Należy do grup", "Pochodzenie klienta", "Osoba polecająca"];
      lines.forEach((l, i) => { if (want.includes(l) && lines[i + 1]) out[l] = lines[i + 1]; });
    }
    return out;
  }

  async function fetchPatient(id) {
    const edit = await page(`/${salon}/customers/${id}/edit`);
    const personal = edit && (await page(`/${salon}/customers/${id}?tab_name=personal_data`));
    if (!edit) return { id, missing: true, fetchedAt: new Date().toISOString() };
    return { id, ...formFields(edit), shown: personal ? shownData(personal) : {}, fetchedAt: new Date().toISOString() };
  }

  async function listIds(onPage) {
    const ids = [];
    for (let p = 1; ; p++) {
      const doc = await page(`/${salon}/customers?size=${PAGE_SIZE}&page=${p}`);
      const found = [...new Set([...doc.querySelectorAll('a[href*="/customers/"]')]
        .map((a) => (a.getAttribute("href").match(/\/customers\/(\d{3,})$/) || [])[1]).filter(Boolean))];
      if (found.length === 0) break;
      ids.push(...found);
      onPage?.(p, ids.length);
      if (found.length < PAGE_SIZE) break;
    }
    return [...new Set(ids)];
  }

  /** `ids`: skip listing (e.g. the ids from an earlier listing, kept in localStorage). */
  async function run({ limit, ids: given } = {}) {
    if (state.running) return status();
    Object.assign(state, { running: true, stop: false, errors: [], phase: "listing" });
    try {
      let ids = given ?? JSON.parse(localStorage.getItem("versum-export-ids") || "null");
      if (!ids) {
        ids = await listIds((p, n) => (state.phase = `listing page ${p} (${n})`));
        localStorage.setItem("versum-export-ids", JSON.stringify(ids));
      }
      if (limit) ids = ids.slice(0, limit);
      const have = new Set((await allKeys()).map(String));
      const todo = ids.filter((id) => !have.has(id));
      Object.assign(state, { total: ids.length, done: ids.length - todo.length, phase: "cards" });
      for (const id of todo) {
        if (state.stop) break;
        try {
          await put(await fetchPatient(id));
          state.done++;
          state.phase = "cards";
        } catch (e) {
          state.errors.push({ id, error: String(e.message || e) });
          if (/logged out/.test(e.message)) state.stop = true;
        }
      }
      state.phase = state.stop ? "stopped" : "finished";
    } catch (e) {
      state.phase = `failed: ${e.message || e}`;
    } finally {
      state.running = false;
    }
    return status();
  }

  function status() {
    return { phase: state.phase, running: state.running, done: state.done, total: state.total, errors: state.errors.length, lastErrors: state.errors.slice(-3) };
  }

  /** Forget the saved patient list, so the next run lists Versum again (picks up cards added since). */
  function relist() {
    localStorage.removeItem("versum-export-ids");
    return "next run() lists patients again";
  }

  async function download() {
    const records = await allRecords();
    const blob = new Blob([records.map((r) => JSON.stringify(r)).join("\n") + "\n"], { type: "application/x-ndjson" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `versum-pacjenci-${new Date().toISOString().slice(0, 10)}.ndjson`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { records: records.length, bytes: blob.size, file: a.download };
  }

  window.versumPatients = { run, status, download, relist, stop: () => { state.stop = true; return status(); }, fetchPatient, count: async () => (await allKeys()).length };
  return "versumPatients ready: run(), status(), stop(), download()";
})();

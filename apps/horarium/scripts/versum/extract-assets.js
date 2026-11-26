// Versum photos and attached files: downloads every asset found by extract-extras.js and saves them
// as one ZIP (no compression) with a manifest, on the computer it runs on.
//
// Paste into the console of the same logged-in panel.versum.com tab, after versumExtras.run() finished:
//
//   versumAssets.list()      count of assets found (no patient data)
//   versumAssets.run()       fetch every asset not fetched yet (one request at a time, >= 1.2 s apart)
//   versumAssets.status()
//   versumAssets.download()  save versum-zalaczniki-YYYY-MM-DD-N.zip (parts of at most 200 MB), each with
//                              manifest.json  [{ patientId, assetId, kind, name, createdAt, description, path }]
//                              <patientId>/<assetId>-<name>
(() => {
  const EXTRAS_DB = "versum-extras-export";
  const DB_NAME = "versum-assets-export";
  const STORE = "assets";
  let GAP_MS = 1200;
  let last = 0;
  const state = { running: false, stop: false, done: 0, total: 0, bytes: 0, errors: [], phase: "idle" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const openDb = (name, upgrade) =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => upgrade?.(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const assetsDb = () => openDb(DB_NAME, (db) => db.createObjectStore(STORE, { keyPath: "assetId" }));

  async function getAll(db, store) {
    const rows = await new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  }
  async function keys() {
    const db = await assetsDb();
    const k = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result));
      req.onerror = () => reject(req.error);
    });
    db.close();
    return k;
  }
  async function put(rec) {
    const db = await assetsDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  /** Every photo and file referenced by the gallery and files tabs saved by extract-extras.js. */
  async function assets() {
    const rows = await getAll(await openDb(EXTRAS_DB), "extras");
    const out = [];
    for (const r of rows) {
      for (const kind of ["gallery", "files"]) {
        if (!r[kind]) continue;
        const doc = new DOMParser().parseFromString(`<div>${r[kind]}</div>`, "text/html");
        const seen = new Set();
        for (const el of doc.querySelectorAll('[data-asset_download_src], a[href$="/download"]')) {
          const url = el.getAttribute("data-asset_download_src") || el.getAttribute("href");
          const assetId = url.match(/assets\/(\d+)\/download/)?.[1];
          if (!assetId || seen.has(assetId)) continue;
          seen.add(assetId);
          out.push({
            patientId: String(r.id),
            assetId,
            kind: kind === "gallery" ? "photo" : "file",
            url,
            name: el.getAttribute("data-name_with_extension") || el.textContent.trim() || null,
            createdAt: el.getAttribute("data-created_at") || el.closest("[class]")?.parentElement?.textContent.match(/\d{2}\.\d{2}\.\d{4}(?: \d{2}:\d{2})?/)?.[0] || null,
            description: el.getAttribute("data-formatted_description") || null,
          });
        }
      }
    }
    return out;
  }

  const filenameFrom = (disposition) => {
    const star = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
    if (star) return decodeURIComponent(star[1]);
    return disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
  };

  async function fetchAsset(a) {
    let backoff = 60_000;
    for (;;) {
      const wait = last + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetch(a.url);
      if (res.status === 429) {
        state.phase = `429, waiting ${backoff / 1000}s`;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 15 * 60_000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const name = a.name || filenameFrom(res.headers.get("content-disposition")) || `plik-${a.assetId}`;
      return { ...a, name, type: blob.type, size: blob.size, blob, fetchedAt: new Date().toISOString() };
    }
  }

  async function run() {
    if (state.running) return "already running";
    state.running = true;
    state.stop = false;
    try {
      const list = await assets();
      const have = await keys();
      state.total = list.length;
      state.done = have.size;
      for (const a of list) {
        if (state.stop) break;
        if (have.has(a.assetId)) continue;
        state.phase = "fetching";
        try {
          const rec = await fetchAsset(a);
          await put(rec);
          state.bytes += rec.size;
          state.done++;
        } catch (error) {
          state.errors.push({ patientId: a.patientId, assetId: a.assetId, error: error.message });
        }
      }
      state.phase = state.stop ? "stopped" : "finished";
    } catch (error) {
      state.phase = `error: ${error.message}`;
    } finally {
      state.running = false;
    }
    return state.phase;
  }

  // Minimal ZIP writer (stored, no compression): photos and PDFs are compressed already.
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const safe = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);

  async function zip(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const { path, data } of entries) {
      const name = enc.encode(path);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(local.buffer, name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(cd.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }

  /**
   * Save the assets as ZIP files of at most `maxMB` each (a browser struggles with one huge file), each
   * with its own manifest.json: versum-zalaczniki-YYYY-MM-DD-1.zip, -2.zip, ...
   */
  async function download(maxMB = 200) {
    const rows = await getAll(await assetsDb(), STORE);
    const groups = [[]];
    let size = 0;
    for (const r of rows) {
      if (size + r.size > maxMB * 1024 * 1024 && groups.at(-1).length) {
        groups.push([]);
        size = 0;
      }
      groups.at(-1).push(r);
      size += r.size;
    }
    const day = new Date().toISOString().slice(0, 10);
    const saved = [];
    for (const [i, group] of groups.entries()) {
      const entries = [];
      const manifest = [];
      for (const r of group) {
        const path = `${r.patientId}/${r.assetId}-${safe(r.name)}`;
        entries.push({ path, data: new Uint8Array(await r.blob.arrayBuffer()) });
        const { blob, url, ...meta } = r;
        manifest.push({ ...meta, path });
      }
      entries.unshift({ path: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 1)) });
      const file = `versum-zalaczniki-${day}-${i + 1}.zip`;
      const blob = await zip(entries);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file;
      a.click();
      await sleep(3000);
      URL.revokeObjectURL(a.href);
      saved.push({ file, assets: group.length, bytes: blob.size });
    }
    return saved;
  }

  async function list() {
    const all = await assets();
    return { assets: all.length, photos: all.filter((a) => a.kind === "photo").length,
      files: all.filter((a) => a.kind === "file").length, patients: new Set(all.map((a) => a.patientId)).size };
  }

  window.versumAssets = { list, run, download, assets, zip,
    status: () => ({ ...state, errors: state.errors.length, lastErrors: state.errors.slice(-3) }),
    stop: () => { state.stop = true; }, setGap: (ms) => { GAP_MS = ms; } };
})();

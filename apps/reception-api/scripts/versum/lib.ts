// Helpers shared by the Versum scripts. Everything that gets printed goes
// through maskPath() or shape(), so values (and with them patient data)
// never reach the console.

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Path with ids masked and query reduced to its keys: /visits/:id?from&to */
export function maskPath(url: string): string {
  const u = new URL(url);
  const path = u.pathname
    .split("/")
    .map((s) => (/^\d+$|^[0-9a-f-]{16,}$|^[A-Za-z0-9_-]{24,}$/i.test(s) ? ":id" : s))
    .join("/");
  const keys = [...new Set(u.searchParams.keys())];
  return path + (keys.length ? `?${keys.join("&")}` : "");
}

export type Shape = string | { [key: string]: Shape } | { array: number; of: Shape };

/** Structure of a JSON value with every value replaced by its type. */
export function shape(value: unknown, depth = 0): Shape {
  if (depth > 6) return "…";
  if (Array.isArray(value)) {
    let of: Shape = "empty";
    for (const item of value.slice(0, 5)) of = merge(of, shape(item, depth + 1));
    return { array: value.length, of };
  }
  if (value && typeof value === "object") {
    const out: { [key: string]: Shape } = {};
    for (const [k, v] of Object.entries(value)) out[k] = shape(v, depth + 1);
    return out;
  }
  return value === null ? "null" : typeof value;
}

function merge(a: Shape, b: Shape): Shape {
  if (a === "empty") return b;
  if (typeof a === "object" && typeof b === "object" && !("array" in a) && !("array" in b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v;
    return out;
  }
  if (typeof a === "string" && typeof b === "string" && a !== b) return `${a}|${b}`;
  return a;
}

/** Spacing between requests we start ourselves. */
export function throttle(minGapMs = 1200) {
  let last = 0;
  return async () => {
    const wait = last + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

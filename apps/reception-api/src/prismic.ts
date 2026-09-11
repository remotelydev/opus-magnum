export interface PriceItem {
  name: string;
  price: string | null;
}

export interface PriceCategory {
  category: string;
  items: PriceItem[];
}

export interface Pricelist {
  source: "prismic";
  uid: string;
  lang: string;
  categories: PriceCategory[];
}

type RichTextBlock = { text?: string };

function asText(field: unknown): string {
  if (typeof field === "string") {
    return field.trim();
  }
  if (Array.isArray(field)) {
    return (field as RichTextBlock[])
      .map((block) => block.text ?? "")
      .join(" ")
      .trim();
  }
  return "";
}

interface PrismicSlice {
  slice_type?: string;
  primary?: { name?: unknown };
  items?: Array<{ name?: unknown; price?: unknown }>;
}

interface PrismicSearchResult {
  results?: Array<{
    uid?: string;
    data?: { slices?: PrismicSlice[] };
  }>;
}

interface PrismicApiRoot {
  refs?: Array<{ ref: string; isMasterRef?: boolean }>;
}

export function parsePricelistSlices(slices: PrismicSlice[]): PriceCategory[] {
  const categories: PriceCategory[] = [];
  for (const slice of slices) {
    if (slice.slice_type !== "pricelist") {
      continue;
    }
    const category = asText(slice.primary?.name);
    const items: PriceItem[] = [];
    for (const item of slice.items ?? []) {
      const name = asText(item.name);
      if (!name) {
        continue;
      }
      const priceRaw = item.price;
      const price =
        typeof priceRaw === "string" && priceRaw.trim() !== ""
          ? priceRaw.trim()
          : null;
      items.push({ name, price });
    }
    if (category || items.length > 0) {
      categories.push({ category, items });
    }
  }
  return categories;
}

async function masterRef(api: string): Promise<string> {
  const response = await fetch(api);
  if (!response.ok) {
    throw new Error(`prismic api ${response.status}`);
  }
  const body = (await response.json()) as PrismicApiRoot;
  const ref = body.refs?.find((entry) => entry.isMasterRef)?.ref;
  if (!ref) {
    throw new Error("prismic master ref missing");
  }
  return ref;
}

export async function fetchPricelist(options: {
  api: string;
  cennikUid: string;
  lang: string;
}): Promise<Pricelist> {
  const ref = await masterRef(options.api);
  const query = `[[at(my.page.uid,"${options.cennikUid}")]]`;
  const url = new URL(`${options.api.replace(/\/$/, "")}/documents/search`);
  url.searchParams.set("ref", ref);
  url.searchParams.set("q", query);
  url.searchParams.set("lang", options.lang);
  url.searchParams.set("pageSize", "1");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`prismic search ${response.status}`);
  }
  const body = (await response.json()) as PrismicSearchResult;
  const doc = body.results?.[0];
  if (!doc) {
    throw new Error(`prismic page ${options.cennikUid} not found`);
  }
  return {
    source: "prismic",
    uid: doc.uid ?? options.cennikUid,
    lang: options.lang,
    categories: parsePricelistSlices(doc.data?.slices ?? []),
  };
}

const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; value: Pricelist } | null = null;

export async function getCachedPricelist(options: {
  api: string;
  cennikUid: string;
  lang: string;
}): Promise<Pricelist> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.value;
  }
  const value = await fetchPricelist(options);
  cache = { at: Date.now(), value };
  return value;
}

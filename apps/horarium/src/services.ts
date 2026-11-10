// Services and price list: one table for the desk, the bot and the clinic website.
import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import { audit, type Db } from "./db.js";

export interface Service {
  id: number;
  category: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMin: number | null;
  priceMax: number | null;
  priceNote: string | null;
  showOnline: boolean;
  sortOrder: number;
  active: boolean;
}

const COLUMNS: Record<keyof Omit<Service, "id">, string> = {
  category: "category",
  name: "name",
  description: "description",
  durationMinutes: "duration_minutes",
  priceMin: "price_min",
  priceMax: "price_max",
  priceNote: "price_note",
  showOnline: "show_online",
  sortOrder: "sort_order",
  active: "active",
};

const PROPS = {
  category: { type: "string", minLength: 1, maxLength: 80 },
  name: { type: "string", minLength: 1, maxLength: 160 },
  description: { type: ["string", "null"], maxLength: 2000 },
  durationMinutes: { type: "integer", minimum: 5, maximum: 480 },
  priceMin: { type: ["number", "null"], minimum: 0 },
  priceMax: { type: ["number", "null"], minimum: 0 },
  priceNote: { type: ["string", "null"], maxLength: 80 },
  showOnline: { type: "boolean" },
  sortOrder: { type: "integer" },
  active: { type: "boolean" },
} as const;

const PUBLIC_CACHE_SECONDS = 300;

function toService(r: Record<string, unknown>): Service {
  const num = (v: unknown) => (v === null ? null : Number(v));
  return {
    id: r.id as number,
    category: r.category as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    durationMinutes: r.duration_minutes as number,
    priceMin: num(r.price_min),
    priceMax: num(r.price_max),
    priceNote: (r.price_note as string | null) ?? null,
    showOnline: r.show_online as boolean,
    sortOrder: r.sort_order as number,
    active: r.active as boolean,
  };
}

function badRequest(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/** priceMax defaults to priceMin (a single price), and may not be below it. */
function checkPrices(min: number | null | undefined, max: number | null | undefined) {
  if (min != null && max != null && max < min) throw badRequest("Cena „do” jest niższa niż „od”.");
}

export function registerServices(
  app: FastifyInstance,
  db: Db,
  guards: { read: preHandlerAsyncHookHandler; admin: preHandlerAsyncHookHandler },
  publicOrigins: string[],
) {
  app.get<{ Querystring: { all?: boolean } }>(
    "/api/services",
    {
      preHandler: guards.read,
      schema: { querystring: { type: "object", properties: { all: { type: "boolean" } } } },
    },
    async (req) => {
      const { rows } = await db.query(
        `SELECT * FROM services WHERE ($1 OR active) ORDER BY category, sort_order, name`,
        [req.query.all === true && req.user?.role === "admin"],
      );
      return rows.map(toService);
    },
  );

  app.post<{ Body: Partial<Service> }>(
    "/api/services",
    {
      preHandler: guards.admin,
      schema: {
        body: { type: "object", required: ["category", "name", "durationMinutes"], properties: PROPS },
      },
    },
    async (req, reply) => {
      const b = { ...req.body };
      if (b.priceMax === undefined) b.priceMax = b.priceMin ?? null;
      checkPrices(b.priceMin, b.priceMax);
      const keys = (Object.keys(b) as (keyof typeof COLUMNS)[]).filter((k) => k in COLUMNS);
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO services (${keys.map((k) => COLUMNS[k]).join(", ")})
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        keys.map((k) => b[k]),
      );
      await audit(db, req.user!.id, "service.create", "service", rows[0].id, b);
      return reply.code(201).send({ id: rows[0].id });
    },
  );

  app.patch<{ Params: { id: number }; Body: Partial<Service> }>(
    "/api/services/:id",
    {
      preHandler: guards.admin,
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
        body: { type: "object", properties: PROPS, minProperties: 1 },
      },
    },
    async (req, reply) => {
      const current = (await db.query("SELECT * FROM services WHERE id = $1", [req.params.id])).rows[0];
      if (!current) return reply.code(404).send({ error: "Nie ma takiej usługi." });
      const b = req.body;
      const before = toService(current);
      checkPrices(b.priceMin === undefined ? before.priceMin : b.priceMin, b.priceMax === undefined ? before.priceMax : b.priceMax);
      const keys = (Object.keys(b) as (keyof typeof COLUMNS)[]).filter((k) => k in COLUMNS);
      if (!keys.length) throw badRequest("Brak pól do zmiany.");
      await db.query(
        `UPDATE services SET ${keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
        [req.params.id, ...keys.map((k) => b[k])],
      );
      const changes = Object.fromEntries(keys.map((k) => [k, { from: before[k], to: b[k] }]));
      await audit(db, req.user!.id, "service.update", "service", req.params.id, changes);
      return { ok: true };
    },
  );

  // Public price list for the clinic website. No login, read-only, only services marked for the website.
  // Publish just this path through the tunnel; the rest of the API stays inside the clinic network.
  app.get("/api/public/services", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && publicOrigins.includes(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
    }
    reply.header("cache-control", `public, max-age=${PUBLIC_CACHE_SECONDS}`);
    const { rows } = await db.query(
      `SELECT category, name, description, duration_minutes, price_min, price_max, price_note, updated_at
         FROM services WHERE active AND show_online ORDER BY category, sort_order, name`,
    );
    const categories: { name: string; services: unknown[] }[] = [];
    let updatedAt = new Date(0);
    for (const r of rows) {
      let group = categories.at(-1);
      if (!group || group.name !== r.category) {
        group = { name: r.category, services: [] };
        categories.push(group);
      }
      group.services.push({
        name: r.name,
        description: r.description,
        durationMinutes: r.duration_minutes,
        priceMin: r.price_min === null ? null : Number(r.price_min),
        priceMax: r.price_max === null ? null : Number(r.price_max),
        priceNote: r.price_note,
      });
      if (r.updated_at > updatedAt) updatedAt = r.updated_at;
    }
    return { currency: "PLN", updatedAt: rows.length ? updatedAt.toISOString() : null, categories };
  });
}

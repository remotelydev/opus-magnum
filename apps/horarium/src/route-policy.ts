import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** How a route proves who is calling. Every route declares one in `config.access`. */
export type Access = "staff" | "device" | "credentials" | "public";

declare module "fastify" {
  interface FastifyContextConfig {
    access?: Access;
    /** `true`: a 2xx answer must have written an audit entry. A string: why this write is not audited. */
    audited?: true | string;
  }
}

const GUARD_KIND = Symbol("guardKind");
type Guard = ((req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) & { [GUARD_KIND]?: Access };

export function tagGuard<T extends Guard>(kind: "staff" | "device", guard: T): T {
  guard[GUARD_KIND] = kind;
  return guard;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Counts the audit entries written while one request runs; audit() adds to it. */
export const auditTrail = new AsyncLocalStorage<{ entries: number }>();

function guardKinds(preHandler: unknown): Access[] {
  const list = Array.isArray(preHandler) ? preHandler : preHandler ? [preHandler] : [];
  return list.flatMap((fn) => ((fn as Guard)[GUARD_KIND] ? [(fn as Guard)[GUARD_KIND]!] : []));
}

/** Register before any route: a route that breaks the policy stops the app from starting. */
export function enforceRoutePolicy(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    const methods = [route.method].flat();
    const name = `${methods.join("/")} ${route.url}`;
    const access = route.config?.access;
    if (!access) {
      throw new Error(`Route ${name} must declare config: { access: "staff" | "device" | "credentials" | "public" }.`);
    }
    const kinds = guardKinds(route.preHandler);
    if ((access === "staff" || access === "device") && !kinds.includes(access)) {
      throw new Error(`Route ${name} declares access "${access}" but has no ${access} guard in preHandler.`);
    }
    if ((access === "public" || access === "credentials") && kinds.length > 0) {
      throw new Error(`Route ${name} declares access "${access}" but has a guard; declare "${kinds[0]}" instead.`);
    }
    if (methods.some((m) => MUTATING.has(m)) && !route.config?.audited) {
      throw new Error(`Route ${name} changes data: declare config: { audited: true }, or audited: "<why not>".`);
    }
  });

  app.addHook("onRequest", (_req, _reply, done) => auditTrail.run({ entries: 0 }, done));

  app.addHook("onSend", async (req, reply, payload) => {
    if (req.routeOptions.config.audited === true && reply.statusCode < 300 && !auditTrail.getStore()?.entries) {
      throw new Error(`${req.method} ${req.routeOptions.url} answered ${reply.statusCode} without writing an audit entry.`);
    }
    return payload;
  });
}

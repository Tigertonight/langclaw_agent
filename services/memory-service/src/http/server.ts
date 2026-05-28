import Fastify from "fastify";
import { loadConfig } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { recordRequest, renderPrometheus, templatize } from "../observability/metrics.js";
import { pingDatabase } from "../db/pool.js";
import { HttpError } from "./errors.js";
import { requireIdentity } from "./identity.js";
import { registerMemoryRoutes, type MemoryRoutesDeps } from "./routes/memories.js";
import { registerMemorySearchRoutes, type MemorySearchRoutesDeps } from "./routes/memory-search.js";
import { registerDocumentRoutes, type DocumentRoutesDeps } from "./routes/documents.js";
import { registerKnowledgeRoutes, type KnowledgeRoutesDeps } from "./routes/knowledge.js";
import { registerGrepRoutes, type GrepRoutesDeps } from "./routes/grep.js";
import { registerMessageRoutes, type MessageRoutesDeps } from "./routes/messages.js";
import { registerEntityRoutes, type EntityRoutesDeps } from "./routes/entities.js";
import { registerRelationRoutes, type RelationRoutesDeps } from "./routes/relations.js";

export interface BuildServerOptions {
  memoryRoutes?: MemoryRoutesDeps;
  memorySearch?: MemorySearchRoutesDeps;
  documentRoutes?: DocumentRoutesDeps;
  knowledgeRoutes?: KnowledgeRoutesDeps;
  grepRoutes?: GrepRoutesDeps;
  messageRoutes?: MessageRoutesDeps;
  entityRoutes?: EntityRoutesDeps;
  relationRoutes?: RelationRoutesDeps;
}

export type FastifyApp = Awaited<ReturnType<typeof buildServer>>;

export async function buildServer(options: BuildServerOptions = {}) {
  const cfg = loadConfig();
  const app = Fastify({
    logger,
    genReqId: () => cryptoRandomId(),
    disableRequestLogging: false,
    bodyLimit: 4 * 1024 * 1024
  });

  app.addHook("onRequest", async (request) => {
    if (isPublicRoute(request.url)) return;
    request.identity = requireIdentity(request);
  });

  app.addHook("onResponse", async (request, reply) => {
    const route = templatize(request.url);
    recordRequest(request.method, route, reply.statusCode, reply.elapsedTime ?? 0);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({
        ok: false,
        error: error.code,
        message: error.message,
        details: error.details ?? undefined,
        request_id: request.id
      });
      return;
    }
    request.log.error({ err: error }, "unhandled_error");
    reply.status(500).send({
      ok: false,
      error: "internal_error",
      message: cfg.NODE_ENV === "production" ? "internal error" : error.message,
      request_id: request.id
    });
  });

  app.get("/healthz", async () => ({ ok: true, status: "alive" }));

  app.get("/readyz", async () => {
    await pingDatabase();
    return { ok: true, status: "ready" };
  });

  app.get("/metrics", async (_request, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4");
    return renderPrometheus();
  });

  app.get("/v1/whoami", async (request) => ({
    ok: true,
    identity: request.identity
  }));

  await registerMemoryRoutes(app, options.memoryRoutes);
  await registerMemorySearchRoutes(app, options.memorySearch);
  await registerDocumentRoutes(app, options.documentRoutes);
  await registerKnowledgeRoutes(app, options.knowledgeRoutes);
  await registerGrepRoutes(app, options.grepRoutes);
  await registerMessageRoutes(app, options.messageRoutes);
  await registerEntityRoutes(app, options.entityRoutes);
  await registerRelationRoutes(app, options.relationRoutes);

  return app;
}

function isPublicRoute(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  return path === "/healthz" || path === "/readyz" || path === "/metrics";
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
}

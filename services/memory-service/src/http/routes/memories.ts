import type { ZodType } from "zod";
import type { FastifyRequest } from "fastify";
import { MemoryRepo, toMemoryDto } from "../../db/memory-repo.js";
import {
  EMBEDDING_STATUS,
  MemoryCreateSchema,
  MemoryListQuerySchema,
  MemoryPatchSchema,
  type MemoryListQuery
} from "../../domain/memory.js";
import { HttpError } from "../errors.js";
import { withTraceSpan } from "../../observability/tracer.js";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw HttpError.badRequest("invalid request body", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message
      }))
    });
  }
  return parsed.data;
}

function assertUuid(id: string): void {
  if (!ID_RE.test(id)) throw HttpError.badRequest("id must be a UUID");
}

/**
 * Fastify app type is intentionally loose: server.ts builds an app whose
 * generic logger type leaks pino specifics, and the inferred FastifyInstance
 * type is incompatible with the default RawServerDefault generics. Routes
 * don't care about the logger generic, so we accept any-typed app here. All
 * request shapes are still type-checked through FastifyRequest below.
 */
export interface MemoryRoutesDeps {
  repo?: MemoryRepo;
}

export async function registerMemoryRoutes(
  app: { post: Function; get: Function; patch: Function; delete: Function },
  deps: MemoryRoutesDeps = {}
): Promise<void> {
  const repo = deps.repo ?? new MemoryRepo();

  app.post("/v1/memories", async (request: FastifyRequest, reply: { status: (n: number) => void }) => {
    const body = parseOrThrow(MemoryCreateSchema, request.body);
    return withTraceSpan(request, "memory.create", async (span) => {
      const row = await repo.create(request.identity, body);
      span.update({ memory_id: row.id, category: row.category });
      reply.status(201);
      return {
        ok: true,
        memory: toMemoryDto(row),
        embedding_status: EMBEDDING_STATUS.QUEUED
      };
    });
  });

  app.get("/v1/memories", async (request: FastifyRequest) => {
    const query = parseOrThrow(MemoryListQuerySchema, request.query) as MemoryListQuery;
    const { items, nextCursor } = await repo.list(request.identity, query);
    return {
      ok: true,
      total: items.length,
      next_cursor: nextCursor,
      items: items.map(toMemoryDto)
    };
  });

  app.get("/v1/memories/:id", async (request: FastifyRequest<{ Params: { id: string } }>) => {
    assertUuid(request.params.id);
    const row = await repo.getById(request.identity, request.params.id);
    if (!row) throw HttpError.notFound("memory not found");
    return { ok: true, memory: toMemoryDto(row) };
  });

  app.patch("/v1/memories/:id", async (request: FastifyRequest<{ Params: { id: string } }>) => {
    assertUuid(request.params.id);
    const patch = parseOrThrow(MemoryPatchSchema, request.body);
    return withTraceSpan(request, "memory.patch", async (span) => {
      const row = await repo.patch(request.identity, request.params.id, patch);
      if (!row) throw HttpError.notFound("memory not found");
      const reembed = patch.content !== undefined;
      span.update({ memory_id: row.id, reembed });
      return {
        ok: true,
        memory: toMemoryDto(row),
        embedding_status: reembed ? EMBEDDING_STATUS.QUEUED : EMBEDDING_STATUS.DONE
      };
    });
  });

  app.delete("/v1/memories/:id", async (request: FastifyRequest<{ Params: { id: string } }>) => {
    assertUuid(request.params.id);
    return withTraceSpan(request, "memory.delete", async (span) => {
      const ok = await repo.softDelete(request.identity, request.params.id);
      if (!ok) throw HttpError.notFound("memory not found");
      span.update({ memory_id: request.params.id });
      return { ok: true, deleted: true };
    });
  });
}

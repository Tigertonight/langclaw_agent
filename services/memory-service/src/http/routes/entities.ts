import type { ZodType } from "zod";
import type { FastifyRequest } from "fastify";
import { EntityRepo, toEntityDto } from "../../db/entity-repo.js";
import {
  EntityCreateSchema,
  EntityListQuerySchema,
  EntityPatchSchema,
  type EntityListQuery
} from "../../domain/entity.js";
import { HttpError } from "../errors.js";

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

function assertEntityId(identity: { business_id: string }, id: string): void {
  if (!id.startsWith(`${identity.business_id}:`)) {
    throw HttpError.badRequest("entity id must be prefixed with caller business_id");
  }
}

export interface EntityRoutesDeps {
  repo?: EntityRepo;
}

export async function registerEntityRoutes(
  app: { post: Function; get: Function; patch: Function; delete: Function },
  deps: EntityRoutesDeps = {}
): Promise<void> {
  const repo = deps.repo ?? new EntityRepo();

  // upsert by default — Phase 2 spec calls /v1/entities an "upsert" endpoint.
  app.post("/v1/entities", async (request: FastifyRequest, reply: { status: (n: number) => void }) => {
    const body = parseOrThrow(EntityCreateSchema, request.body);
    const row = await repo.upsert(request.identity, body);
    reply.status(201);
    return { ok: true, entity: toEntityDto(row) };
  });

  app.get("/v1/entities", async (request: FastifyRequest) => {
    const query = parseOrThrow(EntityListQuerySchema, request.query) as EntityListQuery;
    const { items, nextCursor } = await repo.list(request.identity, query);
    return {
      ok: true,
      total: items.length,
      next_cursor: nextCursor,
      items: items.map(toEntityDto)
    };
  });

  app.get("/v1/entities/:id", async (request: FastifyRequest<{ Params: { id: string } }>) => {
    assertEntityId(request.identity, request.params.id);
    const row = await repo.getById(request.identity, request.params.id);
    if (!row) throw HttpError.notFound("entity not found");
    return { ok: true, entity: toEntityDto(row) };
  });

  app.patch("/v1/entities/:id", async (request: FastifyRequest<{ Params: { id: string } }>) => {
    assertEntityId(request.identity, request.params.id);
    const patch = parseOrThrow(EntityPatchSchema, request.body);
    const row = await repo.patch(request.identity, request.params.id, patch);
    if (!row) throw HttpError.notFound("entity not found");
    return { ok: true, entity: toEntityDto(row) };
  });

  app.delete("/v1/entities/:id", async (request: FastifyRequest<{ Params: { id: string } }>) => {
    assertEntityId(request.identity, request.params.id);
    const ok = await repo.softDelete(request.identity, request.params.id);
    if (!ok) throw HttpError.notFound("entity not found");
    return { ok: true, deleted: true };
  });
}

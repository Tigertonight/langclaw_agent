import type { ZodType } from "zod";
import type { FastifyRequest } from "fastify";
import { RelationRepo, toRelationDto } from "../../db/relation-repo.js";
import { RelationCreateSchema, RelationQuerySchema, type RelationQueryInput } from "../../domain/relation.js";
import { HttpError } from "../errors.js";
import { withTraceSpan } from "../../observability/tracer.js";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RelationRoutesDeps {
  repo?: RelationRepo;
}

export async function registerRelationRoutes(
  app: { post: Function; delete: Function },
  deps: RelationRoutesDeps = {}
): Promise<void> {
  const repo = deps.repo ?? new RelationRepo();

  app.post("/v1/relations", async (request: FastifyRequest, reply: { status: (n: number) => void }) => {
    const body = parseOrThrow(RelationCreateSchema, request.body);
    return withTraceSpan(request, "memory.relation.create", async (span) => {
      const row = await repo.create(request.identity, body);
      span.update({ relation_id: row.id, predicate: row.predicate });
      reply.status(201);
      return { ok: true, relation: toRelationDto(row) };
    });
  });

  app.post("/v1/relations/query", async (request: FastifyRequest) => {
    const body = parseOrThrow(RelationQuerySchema, request.body) as RelationQueryInput;
    const { items, nextCursor } = await repo.query(request.identity, body);
    return {
      ok: true,
      total: items.length,
      next_cursor: nextCursor,
      items: items.map(toRelationDto)
    };
  });

  app.delete("/v1/relations/:id", async (request: FastifyRequest<{ Params: { id: string } }>) => {
    if (!UUID_RE.test(request.params.id)) throw HttpError.badRequest("id must be a UUID");
    const ok = await repo.softDelete(request.identity, request.params.id);
    if (!ok) throw HttpError.notFound("relation not found");
    return { ok: true, deleted: true };
  });
}

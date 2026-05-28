import type { ZodType } from "zod";
import type { FastifyRequest } from "fastify";
import { EntityRepo, toEntityDto } from "../../db/entity-repo.js";
import { EntityResolver } from "../../db/entity-resolver.js";
import { MergeRepo } from "../../db/merge-repo.js";
import {
  EntityCreateSchema,
  EntityListQuerySchema,
  EntityPatchSchema,
  type EntityListQuery
} from "../../domain/entity.js";
import { ResolveRequestSchema, type ResolveRequest } from "../../domain/resolver.js";
import { EntityMergeSchema } from "../../domain/merge.js";
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
  resolver?: EntityResolver;
  mergeRepo?: MergeRepo;
}

export async function registerEntityRoutes(
  app: { post: Function; get: Function; patch: Function; delete: Function },
  deps: EntityRoutesDeps = {}
): Promise<void> {
  const repo = deps.repo ?? new EntityRepo();
  const resolver = deps.resolver ?? new EntityResolver();
  const mergeRepo = deps.mergeRepo ?? new MergeRepo();

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

  // 2.3 EntityResolver — 通用消解能力。Level 1 external_ids / Level 2 强属性
  // / Level 3 name 相似度，三层叠加打分；高于 match_threshold 的最高分直接
  // 作为 matched，否则只回候选列表由调用方/LLM 决策。
  app.post("/v1/entities/resolve", async (request: FastifyRequest) => {
    const body = parseOrThrow(ResolveRequestSchema, request.body) as ResolveRequest;
    const result = await resolver.resolve(request.identity, body);
    return { ok: true, ...result };
  });

  // 2.7 实体合并：把 source 软合并到 target，关系自动迁移到 target，
  // memories.entity_refs 数组改写，写 entity_merge_log 便于回滚审计。
  app.post(
    "/v1/entities/:id/merge",
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      assertEntityId(request.identity, request.params.id);
      const body = parseOrThrow(EntityMergeSchema, request.body);
      const outcome = await mergeRepo.merge(
        request.identity,
        request.params.id,
        body.source_id,
        body.reason,
        body.merged_by
      );
      return {
        ok: true,
        target: toEntityDto(outcome.target),
        source: toEntityDto(outcome.source),
        relations_migrated: outcome.relations_migrated,
        log: outcome.log
      };
    }
  );

  // unmerge：撤销最近一次未回滚的合并。注意只回退实体 merged_into 指针，
  // 已迁移的关系/memories 不再回写（合并后 target 可能已接收新关系，无法
  // 区分原归属）。这是 spec "可逆" 的最小可用语义。
  app.post(
    "/v1/entities/:id/unmerge",
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      assertEntityId(request.identity, request.params.id);
      const log = await mergeRepo.unmerge(request.identity, request.params.id);
      return { ok: true, log };
    }
  );
}

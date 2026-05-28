import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { KnowledgeSearch } from "../../db/knowledge-search.js";
import { KnowledgeSearchSchema, type KnowledgeSearchInput } from "../../domain/search.js";
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

export interface KnowledgeRoutesDeps {
  search?: KnowledgeSearch;
}

export async function registerKnowledgeRoutes(
  app: { post: Function },
  deps: KnowledgeRoutesDeps = {}
): Promise<void> {
  const search = deps.search ?? new KnowledgeSearch();

  app.post("/v1/knowledge/search", async (request: FastifyRequest) => {
    const body = parseOrThrow(KnowledgeSearchSchema, request.body) as KnowledgeSearchInput;
    const items = await search.search(request.identity, body);
    return {
      ok: true,
      total: items.length,
      mode: body.mode,
      sources: body.sources,
      items
    };
  });
}

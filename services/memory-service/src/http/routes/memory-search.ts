import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { MemorySearch } from "../../db/memory-search.js";
import { MemorySearchSchema, type MemorySearchInput } from "../../domain/search.js";
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

export interface MemorySearchRoutesDeps {
  search?: MemorySearch;
}

export async function registerMemorySearchRoutes(
  app: { post: Function },
  deps: MemorySearchRoutesDeps = {}
): Promise<void> {
  const search = deps.search ?? new MemorySearch();

  app.post("/v1/memories/search", async (request: FastifyRequest) => {
    const body = parseOrThrow(MemorySearchSchema, request.body) as MemorySearchInput;
    const items = await search.search(request.identity, body);
    return {
      ok: true,
      total: items.length,
      mode: body.mode,
      items
    };
  });
}

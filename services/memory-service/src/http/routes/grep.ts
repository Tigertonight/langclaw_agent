import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { GrepRepo } from "../../db/grep-repo.js";
import { GrepRequestSchema, type GrepRequest } from "../../domain/grep.js";
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

export interface GrepRoutesDeps {
  repo?: GrepRepo;
}

export async function registerGrepRoutes(
  app: { post: Function },
  deps: GrepRoutesDeps = {}
): Promise<void> {
  const repo = deps.repo ?? new GrepRepo();

  app.post("/v1/memories/grep", async (request: FastifyRequest) => {
    const body = parseOrThrow(GrepRequestSchema, request.body) as GrepRequest;
    try {
      const items = await repo.grepMemories(request.identity, body);
      return { ok: true, total: items.length, items };
    } catch (err) {
      throw mapPgError(err);
    }
  });

  app.post("/v1/documents/grep", async (request: FastifyRequest) => {
    const body = parseOrThrow(GrepRequestSchema, request.body) as GrepRequest;
    try {
      const items = await repo.grepDocuments(request.identity, body);
      return { ok: true, total: items.length, items };
    } catch (err) {
      throw mapPgError(err);
    }
  });
}

function mapPgError(err: unknown): Error {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: string }).code;
    // 2201B = invalid_regular_expression
    if (code === "2201B") {
      return HttpError.badRequest("invalid regular expression", {
        message: (err as { message?: string }).message ?? "regex parse failed"
      });
    }
  }
  return err as Error;
}

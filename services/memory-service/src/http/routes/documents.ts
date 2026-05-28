import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { DocumentBatchIngestSchema, DocumentIngestSchema } from "../../domain/document.js";
import { IngestionPipeline } from "../../ingest/pipeline.js";
import { DocumentRepo, documentRowToDto } from "../../db/document-repo.js";
import { HttpError } from "../errors.js";

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

export interface DocumentRoutesDeps {
  pipeline?: IngestionPipeline;
  repo?: DocumentRepo;
}

export async function registerDocumentRoutes(
  app: { post: Function; get: Function; delete: Function },
  deps: DocumentRoutesDeps = {}
): Promise<void> {
  const repo = deps.repo ?? new DocumentRepo();
  const pipeline = deps.pipeline ?? new IngestionPipeline({ repo });

  app.post("/v1/documents", async (request: FastifyRequest, reply: { status: (n: number) => void }) => {
    const body = parseOrThrow(DocumentIngestSchema, request.body);
    const result = await pipeline.ingestOne(request.identity, body);
    reply.status(result.status === "unchanged" ? 200 : 201);
    return {
      ok: true,
      document: result.document,
      status: result.status,
      chunks_count: result.chunks_count
    };
  });

  app.post("/v1/documents/ingest", async (request: FastifyRequest) => {
    const body = parseOrThrow(DocumentBatchIngestSchema, request.body);
    const results = await pipeline.ingestBatch(request.identity, body.items);
    return {
      ok: true,
      results: results.map((r) => ({
        source_path: r.document.source_path,
        id: r.document.id,
        status: r.status,
        chunks_count: r.chunks_count
      }))
    };
  });

  app.get("/v1/documents", async (request: FastifyRequest<{ Querystring: { category?: string; limit?: string } }>) => {
    const limit = request.query.limit ? Math.min(Math.max(Number(request.query.limit), 1), 200) : 100;
    const rows = await repo.list(request.identity, { category: request.query.category, limit });
    return {
      ok: true,
      total: rows.length,
      items: rows.map((r) => documentRowToDto(r, 0))
    };
  });

  app.get("/v1/documents/:id", async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { include_chunks?: string };
  }>) => {
    assertUuid(request.params.id);
    const row = await repo.findById(request.identity, request.params.id);
    if (!row) throw HttpError.notFound("document not found");
    const includeChunks = request.query.include_chunks === "true";
    const chunks = includeChunks ? await repo.listChunks(request.identity, request.params.id) : [];
    return {
      ok: true,
      document: documentRowToDto(row, chunks.length),
      ...(includeChunks ? { chunks } : {})
    };
  });

  app.get("/v1/documents/:id/chunks", async (request: FastifyRequest<{ Params: { id: string } }>) => {
    assertUuid(request.params.id);
    const doc = await repo.findById(request.identity, request.params.id);
    if (!doc) throw HttpError.notFound("document not found");
    const chunks = await repo.listChunks(request.identity, request.params.id);
    return { ok: true, document_id: request.params.id, total: chunks.length, chunks };
  });

  app.delete("/v1/documents/:id", async (request: FastifyRequest<{ Params: { id: string } }>) => {
    assertUuid(request.params.id);
    const ok = await repo.softDelete(request.identity, request.params.id);
    if (!ok) throw HttpError.notFound("document not found");
    return { ok: true, deleted: true };
  });
}

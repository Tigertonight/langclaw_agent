import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { MessageRepo } from "../../db/message-repo.js";
import {
  MessageBatchSchema,
  MessageListQuerySchema,
  type MessageBatchInput,
  type MessageListQuery
} from "../../domain/message.js";
import { HttpError } from "../errors.js";

function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw HttpError.badRequest("invalid request", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message
      }))
    });
  }
  return parsed.data;
}

export interface MessageRoutesDeps {
  repo?: MessageRepo;
}

export async function registerMessageRoutes(
  app: { post: Function; get: Function },
  deps: MessageRoutesDeps = {}
): Promise<void> {
  const repo = deps.repo ?? new MessageRepo();

  app.post("/v1/messages/batch", async (request: FastifyRequest, reply: { status: (n: number) => void }) => {
    const body = parseOrThrow(MessageBatchSchema, request.body) as MessageBatchInput;
    const inserted = await repo.insertBatch(request.identity, body.items);
    reply.status(201);
    return { ok: true, inserted };
  });

  app.get("/v1/messages", async (request: FastifyRequest<{ Querystring: Record<string, string> }>) => {
    const query = parseOrThrow(MessageListQuerySchema, request.query) as MessageListQuery;
    const { items, next_cursor } = await repo.list(request.identity, query);
    return { ok: true, total: items.length, items, next_cursor };
  });
}

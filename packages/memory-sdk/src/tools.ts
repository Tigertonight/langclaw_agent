import type { CallContext, MemoryClient } from "./client.js";

/**
 * JSON-Schema-like tool definitions matching the spec's 7-tool surface.
 * Framework adapters (LangChain, OpenAI tool-call, MCP) translate from this
 * shape; we keep the SDK framework-agnostic.
 */
export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  /** JSON Schema (Draft 7-ish). Adapters may convert to their preferred dialect. */
  parameters: Record<string, unknown>;
  /** Bound handler — adapters wire ctx via their own identity propagation. */
  invoke: (ctx: CallContext, input: I) => Promise<O>;
}

export interface ToolFactoryOptions {
  client: MemoryClient;
}

const SEARCH_PARAMS = {
  type: "object",
  properties: {
    query: { type: "string", maxLength: 2000 },
    sources: { type: "array", items: { enum: ["memories", "document_chunks", "messages"] } },
    mode: { enum: ["lexical", "vector", "hybrid"], default: "hybrid" },
    top_k: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    filters: {
      type: "object",
      properties: {
        category: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        document_category: { type: "array", items: { type: "string" } },
        since: { type: "string", format: "date-time" }
      }
    }
  },
  required: ["query"]
};

const GREP_PARAMS = {
  type: "object",
  properties: {
    pattern: { type: "string", minLength: 1, maxLength: 500 },
    case_insensitive: { type: "boolean", default: true },
    limit: { type: "integer", minimum: 1, maximum: 500, default: 100 }
  },
  required: ["pattern"]
};

export function buildMemoryTools({ client }: ToolFactoryOptions): ToolDefinition[] {
  return [
    {
      name: "memory_search",
      description: "Hybrid search across memories + documents + messages. Use when you need recall across the user's stored knowledge. Returns ranked snippets with source labels.",
      parameters: SEARCH_PARAMS,
      invoke: (ctx, input) => client.searchKnowledge(ctx, input as never)
    },
    {
      name: "memory_grep",
      description: "Regex grep over memory contents. Use for exact substring or pattern matches when search semantics aren't needed.",
      parameters: GREP_PARAMS,
      invoke: (ctx, input) => client.grepMemories(ctx, input as never)
    },
    {
      name: "memory_create",
      description: "Persist a new memory record. Use when you've learned something stable about the user, project, or domain that should survive future sessions. Choose category from the 7-class set.",
      parameters: {
        type: "object",
        properties: {
          category: { enum: ["user", "feedback", "project", "reference", "procedure", "fact", "episode"] },
          name: { type: "string", maxLength: 200 },
          description: { type: "string", maxLength: 1000 },
          content: { type: "string", maxLength: 8000 },
          source: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          tags: { type: "array", items: { type: "string" } },
          metadata: { type: "object" },
          expired_at: { type: "string", format: "date-time" }
        },
        required: ["category", "name", "content"]
      },
      invoke: (ctx, input) => client.createMemory(ctx, input as never)
    },
    {
      name: "memory_update",
      description: "Patch an existing memory by id. Use for corrections or refinements. Updating content triggers re-embedding.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          patch: { type: "object" }
        },
        required: ["id", "patch"]
      },
      invoke: (ctx, input) => {
        const { id, patch } = input as { id: string; patch: Record<string, unknown> };
        return client.patchMemory(ctx, id, patch as never);
      }
    },
    {
      name: "memory_delete",
      description: "Soft-delete a memory by id. Use when a memory is wrong or no longer applies. Soft-deleted rows stop appearing in search/grep.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", format: "uuid" } },
        required: ["id"]
      },
      invoke: async (ctx, input) => {
        await client.deleteMemory(ctx, (input as { id: string }).id);
        return { ok: true };
      }
    },
    {
      name: "document_grep",
      description: "Regex grep over ingested documents. Use to find exact strings inside reference docs.",
      parameters: GREP_PARAMS,
      invoke: (ctx, input) => client.grepDocuments(ctx, input as never)
    },
    {
      name: "document_get",
      description: "Fetch a single document, optionally with all its chunks. Use after memory_search returns a document_chunk hit and you need the full surrounding context.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          include_chunks: { type: "boolean", default: false }
        },
        required: ["id"]
      },
      invoke: (ctx, input) => {
        const { id, include_chunks } = input as { id: string; include_chunks?: boolean };
        return client.getDocument(ctx, id, include_chunks ?? false);
      }
    }
  ];
}

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
    },
    {
      name: "entity_get",
      description: "Fetch a single entity by full id (must include business_id prefix, e.g. 'dealer_001:customer:c042'). Use when you already know the id from a prior resolve or relation query.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", maxLength: 240 } },
        required: ["id"]
      },
      invoke: (ctx, input) => client.getEntity(ctx, (input as { id: string }).id)
    },
    {
      name: "entity_resolve",
      description: "Resolve an entity from partial signals: business-system external_ids (e.g. {crm_id, dms_id}), strong attributes (phone/email/id_card), or a fuzzy name. Returns matched entity if confident, otherwise candidates ranked by score with reasons. Use before creating a new entity to avoid duplicates.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", maxLength: 80, description: "Entity type, e.g. customer/person/order/product" },
          external_ids: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Business-system primary keys, e.g. {crm_id: 'C-1001'}"
          },
          strong_attributes: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "High-signal attributes, e.g. {phone: '13800001234', email: 'a@b.com'}"
          },
          name_hint: { type: "string", maxLength: 200, description: "Fuzzy name for trigram similarity ranking" },
          max_candidates: { type: "integer", minimum: 1, maximum: 50, default: 5 },
          match_threshold: { type: "number", minimum: 0, maximum: 2, default: 0.8 }
        },
        required: ["type"]
      },
      invoke: (ctx, input) => client.resolveEntity(ctx, input as never)
    },
    {
      name: "query_relations",
      description: "Query the entity relation graph by any combination of subject_id / predicate / object_id, optionally with a time range. Use to answer questions like 'what did this customer order' or 'who complained about product X'. At least one of subject_id, predicate, or object_id is required.",
      parameters: {
        type: "object",
        properties: {
          subject_id: { type: "string", maxLength: 240 },
          predicate: { type: "string", maxLength: 120 },
          object_id: { type: "string", maxLength: 240 },
          occurred_from: { type: "string", format: "date-time" },
          occurred_to: { type: "string", format: "date-time" },
          limit: { type: "integer", minimum: 1, maximum: 500, default: 100 }
        }
      },
      invoke: (ctx, input) => client.queryRelations(ctx, input as never)
    },
    {
      name: "create_relation",
      description: "Write a new relation triple between two entities (or an entity and a literal value). Use after the agent confirms a fact like 'X ordered Y on date D'. Provide exactly one of object_id or object_value.",
      parameters: {
        type: "object",
        properties: {
          subject_id: { type: "string", maxLength: 240 },
          predicate: { type: "string", maxLength: 120 },
          object_id: { type: "string", maxLength: 240 },
          object_value: {},
          occurred_at: { type: "string", format: "date-time" },
          source_memory_id: { type: "string", format: "uuid" },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["subject_id", "predicate"]
      },
      invoke: (ctx, input) => client.createRelation(ctx, input as never)
    }
  ];
}

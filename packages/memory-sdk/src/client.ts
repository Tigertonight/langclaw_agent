import { request } from "undici";
import type { IdentityProvider } from "./identity.js";

export interface MemoryClientOptions {
  /** Base URL of the memory-service, e.g. http://localhost:4310 */
  baseUrl: string;
  /** Header name carrying the signed identity. Defaults to X-Memory-Identity. */
  identityHeader?: string;
  /** Provides per-call identities (business_id + user_id are required). */
  identityProvider: IdentityProvider;
  /** Per-request timeout in ms. Default 10s. */
  timeoutMs?: number;
}

export interface CallContext {
  business_id: string;
  user_id: string;
  agent_id?: string;
  scope?: string[];
  /**
   * 可选 trace 上下文，用于把 memory-service 侧的 span 挂到调用方 trace 下。
   * 由调用方从 ObservabilityPlugin 维护的 run_id→trace 映射里取，None 则 memory-service
   * 自己起独立 trace。Headers: x-trace-id / x-parent-span-id / x-run-id
   */
  trace_id?: string;
  parent_span_id?: string;
  run_id?: string;
}

export interface MemoryListItem {
  id: string;
  category: string;
  name: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MemoryRecord extends MemoryListItem {
  description: string | null;
  source: string | null;
  confidence: number;
  expired_at: string | null;
  embedding_model: string | null;
  embedded_at: string | null;
}

export interface SearchHit {
  id: string;
  source: "memory" | "document_chunk" | "message";
  category?: string;
  title?: string;
  heading_path?: string[];
  document_id?: string;
  content: string;
  tags?: string[];
  score: number;
  score_breakdown?: { rrf?: number; lexical?: number; vector?: number; recency?: number };
  highlights?: string[];
  created_at?: string;
}

export interface KnowledgeSearchInput {
  query: string;
  sources?: ("memories" | "document_chunks" | "messages")[];
  filters?: {
    category?: string[];
    tags?: string[];
    document_category?: string[];
    since?: string;
  };
  mode?: "lexical" | "vector" | "hybrid";
  top_k?: number;
}

export interface MemorySearchInput {
  query: string;
  filters?: { category?: string[]; tags?: string[]; since?: string };
  mode?: "lexical" | "vector" | "hybrid";
  top_k?: number;
  rerank?: boolean;
}

export interface CreateMemoryInput {
  category: "user" | "feedback" | "project" | "reference" | "procedure" | "fact" | "episode";
  name: string;
  description?: string;
  content: string;
  source?: string;
  confidence?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  expired_at?: string;
}

export interface MessageItem {
  session_id: string;
  turn_index: number;
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call?: Record<string, unknown> | null;
  tool_result?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  agent_id?: string;
}

export interface DocumentIngestInput {
  source_path: string;
  content: string;
  title?: string;
  category?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface GrepInput {
  pattern: string;
  case_insensitive?: boolean;
  limit?: number;
  filters?: { category?: string[]; tags?: string[]; since?: string };
}

// ─── Phase 2: entities / relations ─────────────────────────────────────────

export interface EntityRecord {
  id: string;
  business_id: string;
  type: string;
  name: string;
  aliases: string[];
  external_ids: Record<string, string>;
  attributes: Record<string, unknown>;
  embedding_model: string | null;
  embedded_at: string | null;
  created_at: string;
  updated_at: string;
  merged_into: string | null;
}

export interface UpsertEntityInput {
  /** Local id (without business_id prefix). e.g. "customer:c001". */
  local_id: string;
  type: string;
  name: string;
  aliases?: string[];
  external_ids?: Record<string, string>;
  attributes?: Record<string, unknown>;
}

export interface PatchEntityInput {
  type?: string;
  name?: string;
  aliases?: string[];
  external_ids?: Record<string, string>;
  attributes?: Record<string, unknown>;
}

export interface ResolveEntityInput {
  type: string;
  external_ids?: Record<string, string>;
  strong_attributes?: Record<string, string>;
  name_hint?: string;
  max_candidates?: number;
  match_threshold?: number;
}

export interface ResolveCandidate {
  entity: EntityRecord;
  score: number;
  reasons: string[];
}

export interface ResolveResult {
  matched: EntityRecord | null;
  candidates: ResolveCandidate[];
}

export interface RelationRecord {
  id: string;
  business_id: string;
  subject_id: string;
  predicate: string;
  object_id: string | null;
  object_value: unknown | null;
  occurred_at: string | null;
  source_memory_id: string | null;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CreateRelationInput {
  subject_id: string;
  predicate: string;
  object_id?: string | null;
  object_value?: unknown;
  occurred_at?: string | null;
  source_memory_id?: string | null;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface QueryRelationsInput {
  subject_id?: string;
  predicate?: string;
  object_id?: string;
  occurred_from?: string;
  occurred_to?: string;
  limit?: number;
  cursor?: string;
}

export interface MergeEntityInput {
  source_id: string;
  reason?: string;
  merged_by?: string;
}

export interface MergeOutcome {
  target: EntityRecord;
  source: EntityRecord;
  relations_migrated: number;
  log: {
    id: string;
    business_id: string;
    source_entity_id: string;
    target_entity_id: string;
    reason: string | null;
    merged_by: string | null;
    merged_at: string;
    rolled_back_at: string | null;
  };
}

export class MemoryServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "MemoryServiceError";
  }
}

const DEFAULT_HEADER = "X-Memory-Identity";
const DEFAULT_TIMEOUT = 10_000;

export class MemoryClient {
  private readonly baseUrl: string;
  private readonly headerName: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: MemoryClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.headerName = opts.identityHeader ?? DEFAULT_HEADER;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  // ─── memories ──────────────────────────────────────────────────────────
  async createMemory(ctx: CallContext, input: CreateMemoryInput): Promise<MemoryRecord> {
    const res = await this.call<{ memory: MemoryRecord }>(ctx, "POST", "/v1/memories", input);
    return res.memory;
  }

  async getMemory(ctx: CallContext, id: string): Promise<MemoryRecord> {
    const res = await this.call<{ memory: MemoryRecord }>(ctx, "GET", `/v1/memories/${id}`);
    return res.memory;
  }

  async listMemories(
    ctx: CallContext,
    query: { category?: string; tag?: string; limit?: number; cursor?: string } = {}
  ): Promise<{ items: MemoryListItem[]; next_cursor: string | null }> {
    const qs = new URLSearchParams();
    if (query.category) qs.set("category", query.category);
    if (query.tag) qs.set("tag", query.tag);
    if (query.limit) qs.set("limit", String(query.limit));
    if (query.cursor) qs.set("cursor", query.cursor);
    const path = qs.toString() ? `/v1/memories?${qs}` : "/v1/memories";
    return this.call(ctx, "GET", path);
  }

  async patchMemory(ctx: CallContext, id: string, patch: Partial<CreateMemoryInput>): Promise<MemoryRecord> {
    const res = await this.call<{ memory: MemoryRecord }>(ctx, "PATCH", `/v1/memories/${id}`, patch);
    return res.memory;
  }

  async deleteMemory(ctx: CallContext, id: string): Promise<void> {
    await this.call(ctx, "DELETE", `/v1/memories/${id}`);
  }

  async searchMemories(ctx: CallContext, input: MemorySearchInput): Promise<SearchHit[]> {
    const res = await this.call<{ items: SearchHit[] }>(ctx, "POST", "/v1/memories/search", input);
    return res.items;
  }

  async grepMemories(ctx: CallContext, input: GrepInput): Promise<unknown[]> {
    const res = await this.call<{ items: unknown[] }>(ctx, "POST", "/v1/memories/grep", input);
    return res.items;
  }

  // ─── documents ─────────────────────────────────────────────────────────
  async ingestDocument(ctx: CallContext, input: DocumentIngestInput): Promise<unknown> {
    return this.call(ctx, "POST", "/v1/documents", input);
  }

  async ingestDocumentBatch(ctx: CallContext, items: DocumentIngestInput[]): Promise<unknown> {
    return this.call(ctx, "POST", "/v1/documents/ingest", { items });
  }

  async listDocuments(ctx: CallContext, query: { category?: string; limit?: number } = {}): Promise<unknown> {
    const qs = new URLSearchParams();
    if (query.category) qs.set("category", query.category);
    if (query.limit) qs.set("limit", String(query.limit));
    const path = qs.toString() ? `/v1/documents?${qs}` : "/v1/documents";
    return this.call(ctx, "GET", path);
  }

  async getDocument(ctx: CallContext, id: string, includeChunks = false): Promise<unknown> {
    const path = includeChunks ? `/v1/documents/${id}?include_chunks=true` : `/v1/documents/${id}`;
    return this.call(ctx, "GET", path);
  }

  async grepDocuments(ctx: CallContext, input: GrepInput): Promise<unknown[]> {
    const res = await this.call<{ items: unknown[] }>(ctx, "POST", "/v1/documents/grep", input);
    return res.items;
  }

  // ─── knowledge cross-source search ─────────────────────────────────────
  async searchKnowledge(ctx: CallContext, input: KnowledgeSearchInput): Promise<SearchHit[]> {
    const res = await this.call<{ items: SearchHit[] }>(ctx, "POST", "/v1/knowledge/search", input);
    return res.items;
  }

  // ─── messages ──────────────────────────────────────────────────────────
  async batchMessages(ctx: CallContext, items: MessageItem[]): Promise<{ inserted: number }> {
    return this.call(ctx, "POST", "/v1/messages/batch", { items });
  }

  // ─── Phase 2: entities ─────────────────────────────────────────────────
  async upsertEntity(ctx: CallContext, input: UpsertEntityInput): Promise<EntityRecord> {
    const res = await this.call<{ entity: EntityRecord }>(ctx, "POST", "/v1/entities", input);
    return res.entity;
  }

  async getEntity(ctx: CallContext, id: string): Promise<EntityRecord> {
    const res = await this.call<{ entity: EntityRecord }>(ctx, "GET", `/v1/entities/${id}`);
    return res.entity;
  }

  async patchEntity(ctx: CallContext, id: string, patch: PatchEntityInput): Promise<EntityRecord> {
    const res = await this.call<{ entity: EntityRecord }>(ctx, "PATCH", `/v1/entities/${id}`, patch);
    return res.entity;
  }

  async deleteEntity(ctx: CallContext, id: string): Promise<void> {
    await this.call(ctx, "DELETE", `/v1/entities/${id}`);
  }

  async listEntities(
    ctx: CallContext,
    query: {
      type?: string;
      name_contains?: string;
      external_id_key?: string;
      external_id_value?: string;
      limit?: number;
      cursor?: string;
    } = {}
  ): Promise<{ items: EntityRecord[]; next_cursor: string | null }> {
    const qs = new URLSearchParams();
    if (query.type) qs.set("type", query.type);
    if (query.name_contains) qs.set("name_contains", query.name_contains);
    if (query.external_id_key) qs.set("external_id_key", query.external_id_key);
    if (query.external_id_value) qs.set("external_id_value", query.external_id_value);
    if (query.limit) qs.set("limit", String(query.limit));
    if (query.cursor) qs.set("cursor", query.cursor);
    const path = qs.toString() ? `/v1/entities?${qs}` : "/v1/entities";
    return this.call(ctx, "GET", path);
  }

  async resolveEntity(ctx: CallContext, input: ResolveEntityInput): Promise<ResolveResult> {
    return this.call<ResolveResult>(ctx, "POST", "/v1/entities/resolve", input);
  }

  async mergeEntity(ctx: CallContext, targetId: string, input: MergeEntityInput): Promise<MergeOutcome> {
    return this.call<MergeOutcome>(ctx, "POST", `/v1/entities/${targetId}/merge`, input);
  }

  async unmergeEntity(ctx: CallContext, sourceId: string): Promise<unknown> {
    return this.call(ctx, "POST", `/v1/entities/${sourceId}/unmerge`, {});
  }

  // ─── Phase 2: relations ────────────────────────────────────────────────
  async createRelation(ctx: CallContext, input: CreateRelationInput): Promise<RelationRecord> {
    const res = await this.call<{ relation: RelationRecord }>(ctx, "POST", "/v1/relations", input);
    return res.relation;
  }

  async queryRelations(
    ctx: CallContext,
    input: QueryRelationsInput
  ): Promise<{ items: RelationRecord[]; next_cursor: string | null }> {
    return this.call(ctx, "POST", "/v1/relations/query", input);
  }

  async deleteRelation(ctx: CallContext, id: string): Promise<void> {
    await this.call(ctx, "DELETE", `/v1/relations/${id}`);
  }

  // ─── ops ───────────────────────────────────────────────────────────────
  async healthz(): Promise<unknown> {
    return this.callRaw("GET", "/healthz");
  }

  async readyz(): Promise<unknown> {
    return this.callRaw("GET", "/readyz");
  }

  // ─── transport ─────────────────────────────────────────────────────────
  private async call<T = unknown>(ctx: CallContext, method: string, path: string, body?: unknown): Promise<T> {
    const token = this.opts.identityProvider.sign({
      business_id: ctx.business_id,
      user_id: ctx.user_id,
      agent_id: ctx.agent_id,
      scope: ctx.scope
    });
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [this.headerName]: token
    };
    if (ctx.trace_id) headers["x-trace-id"] = ctx.trace_id;
    if (ctx.parent_span_id) headers["x-parent-span-id"] = ctx.parent_span_id;
    if (ctx.run_id) headers["x-run-id"] = ctx.run_id;
    const res = await request(url, {
      method: method as "GET",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      throw new MemoryServiceError(
        `${method} ${path} failed: ${res.statusCode}`,
        res.statusCode,
        parsed
      );
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private async callRaw(method: string, path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await request(url, { method: method as "GET", headersTimeout: this.timeoutMs, bodyTimeout: this.timeoutMs });
    const text = await res.body.text();
    if (res.statusCode >= 400) throw new MemoryServiceError(`${method} ${path} failed: ${res.statusCode}`, res.statusCode, text);
    return text ? JSON.parse(text) : null;
  }
}

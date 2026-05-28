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
    const res = await request(url, {
      method: method as "GET",
      headers: {
        "content-type": "application/json",
        [this.headerName]: token
      },
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

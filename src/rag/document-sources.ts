import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { fetchJson } from "../integrations/http.js";
import { parseFrontmatter, type KnowledgeDocument } from "./document-loader.js";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

export interface DocumentSource {
  loadDocuments(): Promise<KnowledgeDocument[]>;
}

interface LocalMarkdownDocumentSourceOptions {
  root?: string;
}

interface MockTencentDocsSourceOptions {
  fallbackSource?: DocumentSource;
}

interface TencentDocsSourceOptions {
  baseUrl?: string;
  accessToken?: string;
  docIds?: string[];
  contentEndpointTemplate?: string;
  fallbackSource?: DocumentSource;
}

interface TencentDocPayload extends JsonObject {
  markdown?: string;
  content?: string;
  text?: string;
  title?: string;
  name?: string;
  audience?: string;
  updated_at?: string;
  data?: {
    markdown?: string;
    content?: string;
    title?: string;
    audience?: string;
    updated_at?: string;
    [key: string]: JsonValue | undefined;
  };
}

export class LocalMarkdownDocumentSource implements DocumentSource {
  private readonly root: string;

  constructor({ root = "docs/knowledge" }: LocalMarkdownDocumentSourceOptions = {}) {
    this.root = root;
  }

  async loadDocuments(): Promise<KnowledgeDocument[]> {
    const dir = resolveProjectPath(this.root);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
    const documents: KnowledgeDocument[] = [];

    for (const file of files) {
      const raw = await readFile(path.join(dir, file), "utf8");
      const { metadata, body } = parseFrontmatter(raw);
      documents.push({
        id: file,
        provider: "local_markdown",
        external_id: file,
        path: `${this.root}/${file}`,
        title: metadata.title ?? file,
        audience: metadata.audience ?? "all",
        updated_at: metadata.updated_at ?? null,
        body
      });
    }

    return documents;
  }
}

export class MockTencentDocsSource implements DocumentSource {
  private readonly fallbackSource: DocumentSource;

  constructor({ fallbackSource = new LocalMarkdownDocumentSource() }: MockTencentDocsSourceOptions = {}) {
    this.fallbackSource = fallbackSource;
  }

  async loadDocuments(): Promise<KnowledgeDocument[]> {
    const documents = await this.fallbackSource.loadDocuments();
    return documents.map((document) => ({
      ...document,
      provider: "tencent_docs_mock",
      external_id: `mock_tencent_doc:${document.external_id}`
    }));
  }
}

export class TencentDocsSource implements DocumentSource {
  private readonly baseUrl?: string;
  private readonly accessToken?: string;
  private readonly docIds: string[];
  private readonly contentEndpointTemplate?: string;
  private readonly fallbackSource: DocumentSource;

  constructor({
    baseUrl,
    accessToken,
    docIds,
    contentEndpointTemplate,
    fallbackSource = new LocalMarkdownDocumentSource()
  }: TencentDocsSourceOptions) {
    this.baseUrl = baseUrl?.replace(/\/$/, "");
    this.accessToken = accessToken;
    this.docIds = docIds ?? [];
    this.contentEndpointTemplate = contentEndpointTemplate;
    this.fallbackSource = fallbackSource;
  }

  async loadDocuments(): Promise<KnowledgeDocument[]> {
    if (!this.baseUrl || !this.contentEndpointTemplate || this.docIds.length === 0) {
      return this.fallbackSource.loadDocuments();
    }

    const documents: KnowledgeDocument[] = [];
    for (const docId of this.docIds) {
      const payload = await this.fetchDocument(docId);
      documents.push(normalizeTencentDocPayload(docId, payload));
    }
    return documents;
  }

  async fetchDocument(docId: string): Promise<TencentDocPayload> {
    const endpoint = this.contentEndpointTemplate?.replaceAll("{docId}", encodeURIComponent(docId)) ?? "";
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    return fetchJson<TencentDocPayload>(url, { headers });
  }
}

function normalizeTencentDocPayload(docId: string, payload: TencentDocPayload): KnowledgeDocument {
  const body = payload.markdown ?? payload.content ?? payload.text ?? payload.data?.markdown ?? payload.data?.content ?? "";
  const title = payload.title ?? payload.name ?? payload.data?.title ?? docId;
  return {
    id: `tencent:${docId}`,
    provider: "tencent_docs",
    external_id: docId,
    path: `tencent_docs://${docId}`,
    title,
    audience: payload.audience ?? payload.data?.audience ?? "all",
    updated_at: payload.updated_at ?? payload.data?.updated_at ?? null,
    body: String(body)
  };
}

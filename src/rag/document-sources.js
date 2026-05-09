import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { fetchJson } from "../integrations/http.js";
import { parseFrontmatter } from "./document-loader.js";

export class LocalMarkdownDocumentSource {
  constructor({ root = "docs/knowledge" } = {}) {
    this.root = root;
  }

  async loadDocuments() {
    const dir = resolveProjectPath(this.root);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
    const documents = [];

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

export class MockTencentDocsSource {
  constructor({ fallbackSource = new LocalMarkdownDocumentSource() } = {}) {
    this.fallbackSource = fallbackSource;
  }

  async loadDocuments() {
    const documents = await this.fallbackSource.loadDocuments();
    return documents.map((document) => ({
      ...document,
      provider: "tencent_docs_mock",
      external_id: `mock_tencent_doc:${document.external_id}`
    }));
  }
}

export class TencentDocsSource {
  constructor({
    baseUrl,
    accessToken,
    docIds,
    contentEndpointTemplate,
    fallbackSource = new LocalMarkdownDocumentSource()
  }) {
    this.baseUrl = baseUrl?.replace(/\/$/, "");
    this.accessToken = accessToken;
    this.docIds = docIds ?? [];
    this.contentEndpointTemplate = contentEndpointTemplate;
    this.fallbackSource = fallbackSource;
  }

  async loadDocuments() {
    if (!this.baseUrl || !this.contentEndpointTemplate || this.docIds.length === 0) {
      return this.fallbackSource.loadDocuments();
    }

    const documents = [];
    for (const docId of this.docIds) {
      const payload = await this.fetchDocument(docId);
      documents.push(normalizeTencentDocPayload(docId, payload));
    }
    return documents;
  }

  async fetchDocument(docId) {
    const path = this.contentEndpointTemplate.replaceAll("{docId}", encodeURIComponent(docId));
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = {
      Accept: "application/json"
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    return fetchJson(url, { headers });
  }
}

function normalizeTencentDocPayload(docId, payload) {
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

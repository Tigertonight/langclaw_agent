import type { Identity } from "../http/identity.js";
import type { DocumentIngestInput } from "../domain/document.js";
import { DocumentRepo, type IngestResult } from "../db/document-repo.js";
import { parseMarkdown } from "./parser.js";

export interface IngestionPipelineDeps {
  repo?: DocumentRepo;
}

export class IngestionPipeline {
  private readonly repo: DocumentRepo;

  constructor(deps: IngestionPipelineDeps = {}) {
    this.repo = deps.repo ?? new DocumentRepo();
  }

  async ingestOne(identity: Identity, input: DocumentIngestInput): Promise<IngestResult> {
    const parsed = parseMarkdown(input.content);
    return this.repo.upsert(identity, input, parsed);
  }

  async ingestBatch(identity: Identity, items: DocumentIngestInput[]): Promise<IngestResult[]> {
    const results: IngestResult[] = [];
    for (const item of items) {
      results.push(await this.ingestOne(identity, item));
    }
    return results;
  }
}

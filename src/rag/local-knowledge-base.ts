import { filterKnowledgeByPermission } from "../auth/permissions.js";
import { chunkDocument, type KnowledgeChunk } from "./document-loader.js";
import { LocalMarkdownDocumentSource, type DocumentSource } from "./document-sources.js";
import { cosineSimilarity, keywordOverlap, tokenize } from "./text-utils.js";
import type { UserContext } from "../types/agent-contracts.js";

interface KnowledgeIndexChunk extends KnowledgeChunk {
  tokens: string[];
}

export interface KnowledgeSearchOptions {
  topK?: number;
}

export interface KnowledgeSearchResult {
  id: string;
  text: string;
  metadata: KnowledgeChunk["metadata"];
  score: number;
}

export class LocalKnowledgeBase {
  private readonly documentSource: DocumentSource;
  private index: KnowledgeIndexChunk[] | null = null;

  constructor({ documentSource = new LocalMarkdownDocumentSource() }: { documentSource?: DocumentSource } = {}) {
    this.documentSource = documentSource;
  }

  async ensureIndex(): Promise<KnowledgeIndexChunk[]> {
    if (this.index) return this.index;
    const documents = await this.documentSource.loadDocuments();
    this.index = documents.flatMap(chunkDocument).map((chunk) => ({
      ...chunk,
      tokens: tokenize(`${chunk.metadata.title} ${chunk.metadata.heading} ${chunk.text}`)
    }));
    return this.index;
  }

  async search(query: string, user: UserContext, options: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchResult[]> {
    const topK = options.topK ?? 5;
    const queryTokens = tokenize(query);
    const chunks = await this.ensureIndex();

    return chunks
      .filter((chunk) => filterKnowledgeByPermission(user, chunk))
      .map((chunk) => {
        const lexicalScore = keywordOverlap(queryTokens, chunk.tokens);
        const semanticScore = cosineSimilarity(queryTokens, chunk.tokens);
        const headingText = chunk.metadata.heading ?? "";
        const headingTokens = tokenize(headingText);
        const headingOverlap = keywordOverlap(queryTokens, headingTokens);
        const headingBoost = chunk.metadata.heading && query.includes(chunk.metadata.heading) ? 0.15 : 0;
        const standardBoost = query.includes("标准") && headingText.includes("标准") ? 0.2 : 0;
        const score = 0.45 * lexicalScore + 0.3 * semanticScore + 0.25 * headingOverlap + headingBoost + standardBoost;
        return {
          id: chunk.id,
          text: chunk.text,
          metadata: chunk.metadata,
          score: Number(score.toFixed(4))
        };
      })
      .filter((chunk) => chunk.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

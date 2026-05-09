import { filterKnowledgeByPermission } from "../auth/permissions.js";
import { chunkDocument } from "./document-loader.js";
import { LocalMarkdownDocumentSource } from "./document-sources.js";
import { cosineSimilarity, keywordOverlap, tokenize } from "./text-utils.js";

export class LocalKnowledgeBase {
  constructor({ documentSource = new LocalMarkdownDocumentSource() } = {}) {
    this.documentSource = documentSource;
    this.index = null;
  }

  async ensureIndex() {
    if (this.index) return this.index;
    const documents = await this.documentSource.loadDocuments();
    this.index = documents.flatMap(chunkDocument).map((chunk) => ({
      ...chunk,
      tokens: tokenize(`${chunk.metadata.title} ${chunk.metadata.heading} ${chunk.text}`)
    }));
    return this.index;
  }

  async search(query, user, options = {}) {
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

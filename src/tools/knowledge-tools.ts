import type { JsonObject, ToolDefinition, UserContext } from "../types/agent-contracts.js";
import type { KnowledgeSearchOptions, KnowledgeSearchResult } from "../rag/local-knowledge-base.js";

interface KnowledgeBase {
  search(query: string, user: UserContext, options?: KnowledgeSearchOptions): Promise<KnowledgeSearchResult[]>;
}

interface RetrieveKnowledgeArgs extends JsonObject {
  query: string;
  topK?: number;
}

export function createKnowledgeTools({ knowledgeBase }: { knowledgeBase: KnowledgeBase }): ToolDefinition[] {
  return [
    {
      name: "retrieve_knowledge",
      description: "按当前用户权限检索制度、流程、手册和知识库片段。仅当任务需要资料依据或业务数据不足以回答时调用。",
      metadata: {
        required_permissions: ["policy:read"],
        risk_level: "read",
        requires_confirmation: false,
        intents: ["knowledge_qa", "mixed"]
      },
      schema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          topK: { type: "number" }
        }
      },
      async execute(args = {}, context = {}) {
        const input = args as RetrieveKnowledgeArgs;
        const docs = await knowledgeBase.search(input.query, context.user as UserContext, {
          topK: clampTopK(input.topK)
        });
        return {
          ok: true,
          tool: "retrieve_knowledge",
          data: {
            query: input.query,
            total: docs.length,
            docs
          }
        };
      }
    }
  ];
}

function clampTopK(value: unknown): number {
  const topK = Number(value);
  if (!Number.isFinite(topK)) return 5;
  return Math.max(1, Math.min(10, topK));
}

import type { ToolDefinition, UserContext } from "../types/agent-contracts.js";
import type { KnowledgeSearchOptions, KnowledgeSearchResult } from "../rag/local-knowledge-base.js";
import { INTENTS } from "../agent/ports.js";
import { defineTool, z, ToolResultBaseSchema } from "./zod-helpers.js";

interface KnowledgeBase {
  search(query: string, user: UserContext, options?: KnowledgeSearchOptions): Promise<KnowledgeSearchResult[]>;
}

export function createKnowledgeTools({ knowledgeBase }: { knowledgeBase: KnowledgeBase }): ToolDefinition[] {
  return [
    defineTool({
      name: "retrieve_knowledge",
      description: "按当前用户权限检索制度、流程、手册和知识库片段。仅当任务需要资料依据或业务数据不足以回答时调用。",
      metadata: {
        required_permissions: ["policy:read"],
        risk_level: "read",
        requires_confirmation: false,
        intents: [INTENTS.KNOWLEDGE_QA, INTENTS.MIXED]
      },
      inputSchema: z.object({
        query: z.string().min(1).max(500).describe("检索关键词或语义查询"),
        topK: z.number().int().min(1).max(10).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context = {}) {
        const docs = await knowledgeBase.search(args.query, context.user as UserContext, {
          topK: args.topK ?? 5
        });
        return {
          ok: true,
          tool: "retrieve_knowledge",
          data: {
            query: args.query,
            total: docs.length,
            docs
          }
        };
      }
    })
  ];
}

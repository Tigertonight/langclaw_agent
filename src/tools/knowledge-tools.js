export function createKnowledgeTools({ knowledgeBase }) {
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
      async execute(args, context) {
        const docs = await knowledgeBase.search(args.query, context.user, {
          topK: clampTopK(args.topK)
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
    }
  ];
}

function clampTopK(value) {
  const topK = Number(value);
  if (!Number.isFinite(topK)) return 5;
  return Math.max(1, Math.min(10, topK));
}

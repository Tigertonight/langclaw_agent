import type { JsonObject, UserContext } from "../types/agent-contracts.js";
import { getCapabilityDescriptions } from "../domains/runtime-registry.js";

interface AnswerLLM {
  generateAnswer(input: JsonObject): Promise<{ answer?: string }>;
}

export class ChitchatHandler {
  private readonly llm?: AnswerLLM;

  constructor({ llm }: { llm?: AnswerLLM } = {}) {
    this.llm = llm;
  }

  async execute({ user, message }: { user?: UserContext; message?: string } = {}): Promise<{ answer: string }> {
    const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    if (this.llm && apiKey) {
      try {
        const result = await this.llm.generateAnswer({
          user: { name: user?.name ?? "员工" },
          question: message,
          route: { intent: "smalltalk", intent_code: "system.smalltalk" },
          docs: [],
          toolResults: []
        });
        if (result?.answer) return { answer: result.answer };
      } catch {
        // 模板兜底
      }
    }
    return { answer: templateReply(message, user) };
  }
}

function templateReply(message?: string, user?: UserContext): string {
  const name = user?.name ? user.name : "你";
  const text = String(message ?? "").trim();
  // 所有能力描述均由 domain packs 声明，通过 registry 动态获取
  const allCapabilities = getCapabilityDescriptions();
  const capabilityText = allCapabilities.length > 0 ? allCapabilities.join("、") : "查询业务数据";
  if (/^(你好|hi|hello|在吗|嗨)/i.test(text)) {
    return `你好，${name}！我是企业 agent，可以帮你${capabilityText}。`;
  }
  if (/谢谢|多谢|感谢/.test(text)) {
    return "不客气，随时为你服务。";
  }
  if (/再见|拜拜|bye/i.test(text)) {
    return "再见，有需要随时叫我。";
  }
  if (/(能干|能做|会什么|功能|能力)/.test(text)) {
    return `我可以帮你${capabilityText}。`;
  }
  return "我在的，可以告诉我具体想查什么吗？";
}

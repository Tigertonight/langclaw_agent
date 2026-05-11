/**
 * ChitchatHandler：寒暄/能力介绍类，零工具、零知识库。
 */
export class ChitchatHandler {
  constructor({ llm } = {}) {
    this.llm = llm;
  }

  async execute({ user, message } = {}) {
    const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    if (this.llm && apiKey && typeof this.llm.generateAnswer === "function") {
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

function templateReply(message, user) {
  const name = user?.name ? user.name : "你";
  const text = String(message ?? "").trim();
  if (/^(你好|hi|hello|在吗|嗨)/i.test(text)) {
    return `你好，${name}！我是企业 agent，可以帮你查经销商库存、客户/订单、组织架构、请假政策等。`;
  }
  if (/谢谢|多谢|感谢/.test(text)) {
    return "不客气，随时为你服务。";
  }
  if (/再见|拜拜|bye/i.test(text)) {
    return "再见，有需要随时叫我。";
  }
  if (/(能干|能做|会什么|功能|能力)/.test(text)) {
    return "我可以帮你查询经销商库存、客户与订单、组织架构、请假记录，以及解读公司制度、办理请假申请。";
  }
  return "我在的，可以告诉我具体想查什么吗？";
}

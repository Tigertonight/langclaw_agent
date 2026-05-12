/**
 * Router prompt 构建器：把 IntentRegistry 注入 system prompt 与 few-shot。
 */

export function buildSystemPrompt(registry) {
  const codes = registry.listCodes();
  const codeLines = codes.map((manifest) => {
    const params = Object.entries(manifest.params_schema ?? {})
      .map(([key, schema]) => {
        if (schema?.type === "enum" && Array.isArray(schema.values)) {
          return `${key}(enum:${schema.values.join("|")})`;
        }
        return `${key}(${schema?.type ?? "string"})`;
      })
      .join(", ");
    const paramsText = params ? `；参数: ${params}` : "";
    let extra = "";
    if (manifest.metric_definitions) {
      const metricLines = Object.entries(manifest.metric_definitions)
        .map(([name, def]) => `    · ${name}：${def?.definition ?? name}`)
        .join("\n");
      extra = `\n  指标说明（从中选 metric）：\n${metricLines}`;
    }
    return `- ${manifest.intent_code} [${manifest.handler_type}]: ${manifest.description ?? ""}${paramsText}${extra}`;
  }).join("\n");

  // 每个 intent_code 最多取 2 条 example，保证 prompt 里所有意图都被 few-shot 覆盖
  const perCode = new Map();
  for (const item of registry.getAllExamples()) {
    const list = perCode.get(item.intent_code) ?? [];
    if (list.length < 2) list.push(item);
    perCode.set(item.intent_code, list);
  }
  const examples = Array.from(perCode.values()).flat();
  const exampleLines = examples.map((item) => `用户: ${item.example}\n输出: {"intent_code":"${item.intent_code}", ...}`).join("\n");

  return [
    "你是一个企业 agent 的意图路由器。",
    "你的任务是判断用户消息属于哪一个 intent_code，并把消息中明确提到的参数抽取出来。",
    "",
    "可选的 intent_code 列表：",
    codeLines,
    "",
    "输出严格 JSON，schema 如下（不要输出任何额外文字、不要 markdown 包裹）：",
    `{
  "intent_code": "<上述列表中的一个；不确定时填 'general'>",
  "handler_type": "<chitchat|intent_query|workflow|agentic，与 intent_code 的 handler_type 对齐>",
  "params": { "字段名": "值或 null" },
  "confidence": "<high|medium|low>",
  "reasoning": "<一句话理由>"
}`,
    "",
    "几条硬规则：",
    "1. 用户没明确提到的字段，params 中填 null，禁止猜测、禁止用「未知」「无」等占位词。",
    "2. confidence 只能是 high / medium / low 三个枚举值。",
    "3. 不确定属于哪个 intent_code 时，输出 intent_code = \"general\"，handler_type = \"agentic\"。",
    "4. 抽参时严格按用户原文，比如「汉EV」就是「汉EV」，不要简化为「汉」。",
    "5. **明细 vs 聚合**：用户问「有哪些 / 列表 / 明细 / 哪几单 / 哪几条」时选 dealer.query.* 类（明细查询）；问「总额 / 合计 / 平均 / 最高 / 最低 / 占比 / 率 / 多少条 / 多少笔 / 各门店多少」时选 dealer.aggregate.* 类（聚合）。",
    "6. 聚合类必须填 metric（指标名），可选 group_by（用户说「各门店」「按车系」时填，否则 null）。",
    "",
    "few-shot 例子：",
    exampleLines
  ].join("\n");
}

export function buildUserPrompt({ message, user_context, session_state }) {
  return JSON.stringify({
    message,
    user_context: user_context ?? null,
    session_state: session_state ?? null
  }, null, 2);
}

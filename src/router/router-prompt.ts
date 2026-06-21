import { executionClassForHandler } from "./execution-class.js";
import { getRouterPromptHints, getParamExtractionExamples } from "../domains/runtime-registry.js";
import type { IntentRegistry, JsonValue, RouteRequest } from "../types/agent-contracts.js";

interface IntentExample {
  intent_code: string;
  example: string;
}

interface PromptRegistry extends IntentRegistry {
  getAllExamples(): IntentExample[];
}

export function buildSystemPrompt(registry: PromptRegistry): string {
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
    const executionClass = manifest.execution_class ?? executionClassForHandler(manifest.handler_type);
    return `- ${manifest.intent_code} [${executionClass} / ${manifest.handler_type}]: ${manifest.description ?? ""}${paramsText}`;
  }).join("\n");

  const perCode = new Map<string, IntentExample[]>();
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
  "execution_class": "<controlled_execution|autonomous_planning>",
  "handler_type": "<chitchat|intent_query|knowledge_lookup|workflow|agentic，与 intent_code 的 handler_type 对齐>",
  "params": { "字段名": "值或 null" },
  "confidence": "<high|medium|low>",
  "reasoning": "<一句话理由>"
}`,
    "",
    "几条硬规则：",
    "1. 用户没明确提到的字段，params 中填 null，禁止猜测、禁止用「未知」「无」等占位词。",
    "2. confidence 只能是 high / medium / low 三个枚举值。",
    "3. execution_class 是路由第一层：controlled_execution 表示边界明确、可预测完成；autonomous_planning 表示需要开放多步规划、跨意图分析或低置信度兜底。",
    "4. controlled_execution 包含 chitchat / intent_query / knowledge_lookup / workflow：直接回答、单次查询/聚合、知识库检索、受控多轮流程都属于这一类。",
    "5. autonomous_planning 目前对应 agentic：复杂经营分析、原因诊断、跨资源对比、报告/行动计划、无法确定 intent 时都进入这一类。",
    "6. 不确定属于哪个 intent_code 时，输出 intent_code = \"general\"，execution_class = \"autonomous_planning\"，handler_type = \"agentic\"。",
    `7. 抽参时严格按用户原文。${getParamExtractionExamples().join("")}`,
    "8. **明细 vs 聚合**：用户问「有哪些 / 列表 / 明细 / 哪几单 / 哪几条」时选 <domain>.query.* 类（明细查询）；问「总额 / 合计 / 平均 / 最高 / 最低 / 占比 / 率 / 多少条 / 多少笔 / 各门店多少」时选 <domain>.aggregate.* 类（聚合）。",
    "9. 聚合类必须填 metric（指标名），可选 group_by（用户说「各门店」「按车系」时填，否则 null）。",
    "10. **时间基准**：解析「本月 / 上月 / 近一个月 / 近三个月 / 昨天 / 今天 / 本周」等相对时间时，以 user prompt 里的 now 字段为基准（now 是 ISO 时间戳）。time_range 仍按用户原文回填（如「本月」「近一个月」），不要自己换算成具体日期。",
    "11. **多轮修参（重要）**：当 session_state.last_query_route 在 10 分钟内、且当前用户消息明显是『修改/补充/省略指代』时（典型形态：『改成 X』『换成 X』『那 Y 呢』『只看 Z』『按 W 分组』『再加上 V』，或者整句话只是一个孤立的车系/门店/状态值），应**沿用 last_query_route.intent_code**，把 last_query_route.params 与本轮新提到的字段合并（新字段覆盖旧字段，未提及字段保留旧值）。confidence 根据继承+新字段的明确度给 high/medium。如果用户消息明显在开启新查询（提到了不同的资源/动作），则忽略 last_query_route。",
    "12. **滑窗仅作上下文**：session_state.recent_messages（最近用户原话）和 recent_routes（最近的查询历史）只是参考，用来理解代词指代和用户的关注脉络。不要把 recent_routes 里的 intent_code/params 当成『必须命中』的目标——除非当前消息显式指向它们。",
    "13. **场景隔离**：如果 user prompt 带 selected_domain，应优先只在该业务域内选择 intent_code。除 system / knowledge / general 外，不要选择其他业务域的 intent_code；用户明显在问其他业务域时，输出 general/agentic 让系统提示切换场景。",
    // 注入域注册的路由提示词片段
    ...getRouterPromptHints().map((hint, i) => `${14 + i}. ${hint}`),
    "",
    "few-shot 例子：",
    exampleLines
  ].join("\n");
}

export function buildUserPrompt({
  message,
  now,
  user_context,
  selected_domain,
  session_state
}: RouteRequest): string {
  return JSON.stringify({
    now: now ?? null,
    message,
    selected_domain: selected_domain ?? null,
    user_context: user_context ?? null,
    session_state: session_state as JsonValue ?? null
  }, null, 2);
}

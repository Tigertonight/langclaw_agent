/**
 * AgenticHandler：跨意图的 LLM tool-calling 循环。
 *
 * 设计原则（v1）：
 *   - intent_code 是 agent 的工具，但不是唯一来源。getAvailableTools()
 *     按三类拼装：intent.* / skill.* / tool.*。第一版只有 intent，后两类
 *     返回空数组占位。
 *   - 每一步 LLM 决定调哪个工具；调 intent.* 时落到 IntentQueryHandler.execute；
 *     调 skill.* / tool.* 在第一版会报 not_implemented（v2 接入）。
 *   - 步数上限 5；每步超时 20s；总超时 60s。
 *   - 不重写 router、不重写 IntentQueryHandler，只是另一种调度方式。
 *
 * 未来扩展（v3 hook）：
 *   - 在 decide 阶段，LLM 可以输出 action.type=propose_tool，描述一个临时步骤。
 *     由系统决定是否实现。本期不做，但 normalizeAction 已经预留了分支。
 */

// 三类工具组合时，典型路径：intent×2 + tool.safe_compute + skill.* 注入 + answer = 5 步起。
// 留点余量给单步抖动重试，定 7。
const MAX_ITERATIONS = 7;
// v2 起 system prompt 里要列 intent.* / tool.* / skill.* 三类工具，整个 prompt 接近 4-5KB，
// MiniMax-M2.7 单步推理 20s 容易超时；适度放宽到 35s。总时长同步拉到 120s。
const STEP_TIMEOUT_MS = 35000;
const TOTAL_TIMEOUT_MS = 180000;

export class AgenticHandler {
  // v2 起 skillRegistry 期望是 AgenticSkillView（注入式 skill 视图），
  // 字段名保留是为了让 v1 期写好的 getAvailableTools 兼容。
  constructor({ intentRegistry, intentQueryHandler, skillRegistry = null, toolRegistry = null } = {}) {
    this.intentRegistry = intentRegistry;
    this.intentQueryHandler = intentQueryHandler;
    this.skillRegistry = skillRegistry;
    this.toolRegistry = toolRegistry;
  }

  async execute({ user, message, route, session } = {}) {
    const startedAt = Date.now();
    const tools = this.getAvailableTools({ user });
    const traces = [];
    let answer = null;
    let lastError = null;

    const apiKey = process.env.LLM_DECISION_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return this.buildFallback({ message, route, reason: "未配置 LLM_API_KEY，agentic 直接兜底返回。", traces });
    }

    const conversation = [
      { role: "system", content: this.buildSystemPrompt({ tools, user }) },
      { role: "user", content: message }
    ];

    for (let step = 0; step < MAX_ITERATIONS; step += 1) {
      if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) {
        lastError = "agentic 总时长超时";
        break;
      }
      // 单步 LLM 失败时最多重试 3 次（共 4 次），覆盖 MiniMax 偶发空 content / 非 JSON / 超时
      let decision;
      let stepErr = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          decision = await this.decideNext({ conversation, apiKey, tools });
          stepErr = null;
          break;
        } catch (err) {
          stepErr = err;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (stepErr) {
        lastError = stepErr?.message || String(stepErr);
        break;
      }
      conversation.push({ role: "assistant", content: JSON.stringify(decision) });

      if (decision.action === "answer") {
        answer = decision.answer ?? "";
        traces.push({ step, type: "answer", reason: decision.reason });
        break;
      }
      if (decision.action === "tool_call") {
        const callName = decision.tool_name;
        const args = decision.args ?? {};
        const observation = await this.callTool({ callName, args, user, session });
        traces.push({ step, type: "tool_call", tool: callName, args, observation_summary: summarizeObservation(observation) });
        // skill.* 是"注入式工具"：不返回结构化结果，而是把 SKILL.md+模板+示例
        // 当作新到的专家说明塞进对话，让主 LLM 下一步直接 answer。
        if (observation?._kind === "skill_injection") {
          conversation.push({
            role: "user",
            content: `（由 ${callName} 注入的写作说明 / 上下文，请据此直接给最终 answer）\n\n${truncate(observation.injection_text, 6000)}`
          });
        } else {
          conversation.push({
            role: "user",
            content: `工具 ${callName} 返回：\n${truncate(JSON.stringify(observation), 4000)}`
          });
        }
        continue;
      }
      // v3 thin：propose_tool 只观察、不真造工具；写进 traces 后给 LLM 推回 stub
      // 让它改用现有 intent.* / tool.* / skill.* 或直接 answer。计入步数，避免反复刷。
      if (decision.action === "propose_tool") {
        const proposal = normalizeProposal(decision.proposed_tool ?? decision.proposal ?? {});
        traces.push({ step, type: "propose_tool", proposal, reason: decision.reason });
        conversation.push({
          role: "user",
          content: `已记录你的工具提议「${proposal.name ?? "(unnamed)"}」（仅作后续设计参考，本期不会动态创建工具）。请用现有 intent.* / tool.* / skill.* 完成任务，或直接 answer。`
        });
        continue;
      }
      lastError = `agentic 未识别的 action：${decision.action}`;
      break;
    }

    if (!answer) {
      if (process.env.AGENTIC_DEBUG === "1") {
        console.error("[agentic] no answer; traces=", JSON.stringify(traces, null, 2), "lastError=", lastError);
      }
      return this.buildFallback({ message, route, reason: lastError ?? "未在步数上限内得到答案", traces });
    }
    return {
      answer,
      table: { rows: [], fields: [] },
      debug: {
        intent_code: route.intent_code,
        agentic: true,
        iterations: traces.length,
        traces,
        latency_ms: Date.now() - startedAt
      },
      toolPlan: { calls: traces.filter((t) => t.type === "tool_call").map((t) => ({ name: t.tool, args: t.args })) },
      toolResults: []
    };
  }

  getAvailableTools({ user }) {
    const list = [];
    // 1. intent.*
    for (const manifest of this.intentRegistry.listCodes()) {
      // 跨意图规划只暴露 intent_query / 聚合类（chitchat/agentic 不该被自己调用）
      if (manifest.handler_type !== "intent_query") continue;
      list.push({
        name: `intent.${manifest.intent_code}`,
        kind: "intent",
        description: manifest.description ?? manifest.intent_code,
        params_schema: manifest.params_schema ?? {},
        manifest
      });
    }
    // 2. skill.*（v2 接入，v1 占位空）
    if (this.skillRegistry?.listForAgent) {
      for (const skill of this.skillRegistry.listForAgent({ user }) ?? []) {
        list.push({ ...skill, kind: "skill", name: `skill.${skill.id}` });
      }
    }
    // 3. tool.*（v2 接入；只露出标了 expose_to_agentic 的）
    if (this.toolRegistry?.list) {
      for (const tool of this.toolRegistry.list({ user }) ?? []) {
        if (!tool.metadata?.expose_to_agentic) continue;
        // tool.schema 是 JSON Schema（type=object, properties=...），转成统一的 {key:{type,description}}
        const params_schema = {};
        const props = tool.schema?.properties ?? {};
        for (const [k, v] of Object.entries(props)) {
          params_schema[k] = { type: v?.type ?? "string", description: v?.description ?? "" };
        }
        list.push({
          name: `tool.${tool.name}`,
          kind: "tool",
          description: tool.description,
          params_schema,
          underlying: tool.name
        });
      }
    }
    return list;
  }

  buildSystemPrompt({ tools, user }) {
    const toolLines = tools.map((t) => {
      const params = Object.entries(t.params_schema ?? {})
        .map(([k, s]) => `${k}(${s?.type ?? "string"})`)
        .join(", ");
      return `- ${t.name} [${t.kind}]: ${t.description}${params ? `；参数: ${params}` : ""}`;
    }).join("\n");
    return [
      "你是企业 agent 的跨意图规划器。当用户的问题需要组合多个查询、对比、归因、推理时由你处理。",
      "",
      `当前用户：${user?.name ?? "?"}（${user?.role ?? "?"}/${user?.department ?? "?"}）`,
      "",
      "可用工具：",
      "- intent.* ：业务高级查询（按口径返回 rows/answer，先用它拿数据）。",
      "- tool.*   ：原子能力，例如 tool.safe_compute 在沙箱里跑 JS 算精确指标（加权库龄、占比、差额等）。",
      "- skill.*  ：注入式『写作/汇报包』。调用后会把它的 SKILL.md + 模板渲染结果塞进上下文，下一步你直接 answer 输出文案。",
      toolLines,
      "",
      "工作流程：每一轮你输出严格 JSON，schema 如下，不要 markdown：",
      `{
  "action": "tool_call" | "answer",
  "tool_name": "<当 action=tool_call 时填工具名>",
  "args": { ... },
  "answer": "<当 action=answer 时填最终回答>",
  "reason": "<一句话理由>"
}`,
      "",
      "硬规则：",
      "1. action=tool_call 时只能调 上面列表里的 工具；args 严格按 params_schema。",
      "2. 一次一个 tool_call；下一轮你会收到工具的观察结果再继续。",
      "3. 步数上限 5。能用 1-2 步搞定就别用 3 步。",
      "4. 用户没明确给出的字段填 null；不要瞎猜门店/车系。",
      "5. 有充分信息就直接 action=answer 给最终回答，回答里把『我做了什么、看到了什么、结论』讲清楚。",
      "6. 如果跨意图任务其实只需要单个 intent，仍然走单个 tool_call → answer 两步。",
      "7. 罕见情况：如果你强烈认为现有工具列表完全不够、需要某个全新能力，可以把 action 设为 propose_tool 并附 proposed_tool: {name, what_it_does, why_needed}（仅做记录，本期不会真执行；下一步你还得用现有工具或 answer）。绝大多数任务都不该走这条。"
    ].join("\n");
  }

  async decideNext({ conversation, apiKey }) {
    const baseUrl = (process.env.LLM_DECISION_BASE_URL ?? process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
    const model = process.env.LLM_DECISION_MODEL ?? process.env.LLM_MODEL ?? process.env.OPENAI_MODEL ?? "MiniMax-M2.7";
    const body = {
      model,
      messages: conversation,
      temperature: 0,
      stream: false,
      response_format: { type: "json_object" }
    };
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      // 部分服务端不支持 response_format，剥掉重试
      delete body.response_format;
      const retry = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        body: JSON.stringify(body)
      });
      if (!retry.ok) throw new Error(`agentic LLM HTTP ${retry.status}`);
      return parseDecision(await retry.json());
    }
    return parseDecision(await response.json());
  }

  async callTool({ callName, args, user, session }) {
    if (callName?.startsWith("intent.")) {
      const intent_code = callName.slice("intent.".length);
      const manifest = this.intentRegistry.getCode(intent_code);
      if (!manifest) return { ok: false, error: "unknown_intent", message: `intent ${intent_code} 不存在` };
      const result = await this.intentQueryHandler.execute({
        user,
        message: "(by agentic)",
        intent_code,
        params: args ?? {},
        route: { intent_code, params: args, source: "agentic" },
        session
      });
      return {
        ok: !result.debug?.denied,
        intent_code,
        answer: result.answer,
        rows: result.table?.rows ?? [],
        row_count: result.debug?.row_count ?? (result.table?.rows?.length ?? 0)
      };
    }
    if (callName?.startsWith("skill.")) {
      const requested = callName.slice("skill.".length);
      if (!this.skillRegistry?.loadForInjection) {
        return { ok: false, error: "skill_not_wired", message: "AgenticSkillView 未接入" };
      }
      // LLM 可能把 dash/underscore 写混（summarize-alert vs summarize_alert），统一兜底
      const skillId = this.skillRegistry.skills?.find?.((s) => s.id === requested)
        ? requested
        : (this.skillRegistry.skills ?? []).find((s) => normalizeSkillId(s.id) === normalizeSkillId(requested))?.id ?? requested;
      const inj = await this.skillRegistry.loadForInjection({ id: skillId, args, user });
      if (!inj.ok) return inj;
      return {
        _kind: "skill_injection",
        ok: true,
        skill: inj.skill,
        injection_text: inj.injection_text,
        preprocess_vars: inj.preprocess_vars
      };
    }
    if (callName?.startsWith("tool.")) {
      const underlying = callName.slice("tool.".length);
      if (!this.toolRegistry?.execute) {
        return { ok: false, error: "tool_not_wired", message: "ToolRegistry 未接入" };
      }
      const tool = this.toolRegistry.get?.(underlying);
      if (!tool) return { ok: false, error: "unknown_tool", message: `tool ${underlying} 不存在` };
      if (!tool.metadata?.expose_to_agentic) {
        return { ok: false, error: "tool_not_exposed", message: `tool ${underlying} 未授权 agentic 直接调用` };
      }
      const result = await this.toolRegistry.execute({ name: underlying, args }, { user });
      return result;
    }
    return { ok: false, error: "unknown_tool_namespace", message: `工具名 ${callName} 必须以 intent./skill./tool. 开头` };
  }

  buildFallback({ message, route, reason, traces }) {
    return {
      answer: `这个问题暂时无法直接给出答案（${reason}）。建议拆成更具体的查询再问一次。`,
      table: { rows: [], fields: [] },
      debug: {
        intent_code: route?.intent_code ?? "general",
        agentic: true,
        fallback: true,
        reason,
        traces
      },
      toolPlan: { calls: [] },
      toolResults: []
    };
  }
}

function parseDecision(json) {
  const raw = json?.choices?.[0]?.message?.content ?? "";
  if (!raw || !raw.trim()) {
    if (process.env.AGENTIC_DEBUG === "1") {
      console.error("[agentic] LLM 返回空 content（finish_reason=", json?.choices?.[0]?.finish_reason, "）");
    }
    throw new Error("agentic LLM 返回空 content");
  }
  const cleaned = stripCodeFence(raw);
  const parsed = tryParseJSON(cleaned);
  if (!parsed || typeof parsed !== "object") {
    if (process.env.AGENTIC_DEBUG === "1") {
      console.error("[agentic] JSON parse failed; raw content (first 600 chars):", String(raw).slice(0, 600));
    }
    throw new Error("agentic LLM 输出无法解析为 JSON");
  }
  return parsed;
}

function stripCodeFence(text) {
  if (typeof text !== "string") return "";
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
  }
  trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return trimmed;
}

function tryParseJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function truncate(text, max) {
  if (typeof text !== "string") return "";
  return text.length > max ? text.slice(0, max) + "...(truncated)" : text;
}

function normalizeSkillId(s) {
  return String(s ?? "").replace(/[-_]/g, "").toLowerCase();
}

function normalizeProposal(raw) {
  if (!raw || typeof raw !== "object") return { name: null, what_it_does: null, why_needed: null, sample_args: null };
  return {
    name: typeof raw.name === "string" ? raw.name.slice(0, 120) : null,
    what_it_does: typeof raw.what_it_does === "string" ? raw.what_it_does.slice(0, 600) : null,
    why_needed: typeof raw.why_needed === "string" ? raw.why_needed.slice(0, 600) : null,
    sample_args: raw.sample_args ?? null
  };
}

function summarizeObservation(observation) {
  if (!observation) return null;
  if (observation._kind === "skill_injection") {
    return { kind: "skill_injection", skill: observation.skill, injected_chars: observation.injection_text?.length ?? 0 };
  }
  if (observation.intent_code) {
    return { intent_code: observation.intent_code, ok: observation.ok, row_count: observation.row_count };
  }
  if (observation.tool === "safe_compute") {
    return { tool: "safe_compute", ok: observation.ok, value_preview: JSON.stringify(observation.data?.value ?? null).slice(0, 120) };
  }
  return { ok: observation.ok, error: observation.error };
}

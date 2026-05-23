import type { JsonObject, JsonValue, SkillDefinition, ToolPlan, ToolResult } from "../types/agent-contracts.js";
import type { KnowledgeSearchResult } from "../rag/local-knowledge-base.js";

export interface AgentStep {
  phase: string;
  title: string;
  detail: string;
  status: string;
  at: string;
  [key: string]: JsonValue | JsonObject | undefined;
}

/**
 * 强类型事件 schema，灵感来自 OpenClaw `AgentEventStream` + `AgentItemEventData`。
 *
 * 业务流（onBlockReply）/ Debug 流（agent_steps）/ 时间流（lifecycle）原本各发各的事件，
 * 容易漂移。通过统一的 item 抽象，让一次"工具调用 / 命令执行 / 检索操作"在三个视角下
 * 共享同一个 itemId 与生命周期，业务流读 summary、Debug 读全字段、时间流看 phase 排序。
 *
 * 这是新增能力，不替换 AgentStep / lifecycle/assistant/tool 三个原始 array。
 */
export type AgentEventStream =
  | "lifecycle"
  | "assistant"
  | "tool"
  | "thinking"
  | "error"
  | "approval";

export type AgentEventPhase = "start" | "update" | "end";

export type AgentItemKind = "tool" | "command" | "search" | "analysis" | "patch" | "skill";

export type AgentItemStatus = "running" | "completed" | "failed" | "blocked";

export interface AgentItemEvent {
  itemId: string;
  stream: AgentEventStream;
  phase: AgentEventPhase;
  kind: AgentItemKind;
  status: AgentItemStatus;
  title: string;
  summary?: string;
  meta?: JsonObject;
  toolCallId?: string;
  /** 相对会话开始的毫秒数，与 lifecycle/assistant/tool 三个 array 的 ts 对齐 */
  ts?: number;
  startedAt?: string;
  endedAt?: string;
  error?: { code: string; message: string };
}

let __itemIdSeq = 0;
export function nextAgentItemId(prefix = "item"): string {
  __itemIdSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${__itemIdSeq.toString(36)}`;
}

/**
 * 把一次工具调用浓缩成一组 item 事件（start + end）。
 * 调用方拿到这两个事件后可以直接 push 给 onEmit，也可以拆开做更细的 update。
 */
export function buildToolItemEvents(input: {
  itemId: string;
  toolName: string;
  args?: JsonObject;
  ts: number;
  result?: ToolResult;
  toolCallId?: string;
}): { start: AgentItemEvent; end: AgentItemEvent } {
  const { itemId, toolName, args, ts, result, toolCallId } = input;
  const start: AgentItemEvent = {
    itemId,
    stream: "tool",
    phase: "start",
    kind: "tool",
    status: "running",
    title: toolName,
    summary: `开始调用 ${toolName}`,
    meta: args ? { args } : undefined,
    toolCallId,
    ts,
    startedAt: new Date().toISOString()
  };
  const failed = !!result && (result.ok === false || result.isError === true);
  const end: AgentItemEvent = {
    itemId,
    stream: "tool",
    phase: "end",
    kind: "tool",
    status: failed ? "failed" : "completed",
    title: toolName,
    summary: result ? summarizeToolResultText(result) : "工具调用结束",
    meta: result ? { result_ok: result.ok ?? !failed, code: result.code } : undefined,
    toolCallId,
    ts,
    endedAt: new Date().toISOString(),
    error: failed
      ? { code: String(result?.code ?? result?.error ?? "execution_failed"), message: String(result?.message ?? "") }
      : undefined
  };
  return { start, end };
}

function summarizeToolResultText(result: ToolResult): string {
  if (result.ok === false || result.isError === true) {
    return `失败：${result.message ?? result.error ?? "未知错误"}`;
  }
  if (result.tool === "query_business_data") {
    const data = result.data ?? {};
    if (data.operation === "aggregate") return `统计返回，匹配 ${data.total ?? 0} 条`;
    return `返回 ${data.rows?.length ?? 0} 条记录`;
  }
  return "调用完成";
}

interface AgentObservationState {
  observations?: Array<{ summary?: string }>;
  missing_facts?: string[];
  known_facts?: JsonValue;
  status?: string;
}

export function createSources(docs: KnowledgeSearchResult[]): Array<{ id: string; source: string; title: string; heading: string; score: number; quote: string }> {
  return docs.map((doc) => ({
    id: doc.id,
    source: doc.metadata.source,
    title: doc.metadata.title,
    heading: doc.metadata.heading,
    score: doc.score,
    quote: String(doc.text ?? "").replace(/\s+/g, " ").trim().slice(0, 180)
  }));
}

export function createAgentStep(phase: string, title: string, detail: string, extra: JsonObject = {}): AgentStep {
  return {
    phase,
    title,
    detail,
    status: "completed",
    at: new Date().toISOString(),
    ...extra
  };
}

export function createSkillStep(skills: SkillDefinition[]): AgentStep {
  if (!skills.length) {
    return createAgentStep("load_skill", "加载技能说明", "未匹配到专用 skill，使用通用 Agent 运行规则。", {
      observation: { skills: [] }
    });
  }

  return createAgentStep(
    "load_skill",
    "加载技能说明",
    `已加载 ${skills.length} 个 skill：${skills.map((skill) => skill.name).join("、")}。`,
    {
      observation: {
        skills: skills.map((skill) => ({
          name: skill.name,
          path: skill.skill_path,
          description: skill.description
        }))
      }
    }
  );
}

export function createKnowledgeStep(docs: KnowledgeSearchResult[]): AgentStep {
  if (docs.length === 0) {
    return createAgentStep("retrieve_knowledge", "检索知识库", "没有命中可直接引用的知识库片段。", {
      observation: { hits: 0 }
    });
  }

  const best = docs[0];
  return createAgentStep(
    "retrieve_knowledge",
    "检索知识库",
    `命中 ${docs.length} 个片段，优先参考「${best.metadata.title} / ${best.metadata.heading}」。`,
    {
      observation: {
        hits: docs.length,
        top_source: best.metadata.source,
        top_title: best.metadata.title,
        top_heading: best.metadata.heading,
        top_score: best.score
      }
    }
  );
}

export function createPlanStep(toolPlan: ToolPlan & { clarification?: string }): AgentStep {
  const calls = toolPlan.calls ?? [];
  if (toolPlan.clarification && calls.length === 0) {
    return createAgentStep("plan_action", "规划下一步", "当前信息不足，需要先向用户追问。", {
      action: { type: "ask_user" }
    });
  }
  if (calls.length === 0) {
    return createAgentStep("plan_action", "规划下一步", "当前问题不需要调用业务工具，直接基于已检索信息回答。", {
      action: { type: "final_answer" }
    });
  }

  return createAgentStep("plan_action", "规划下一步", `准备调用 ${calls.length} 个工具：${calls.map((call) => readableToolName(call.name)).join("、")}。`, {
    action: {
      type: "tool_call",
      tools: calls.map((call) => call.name)
    }
  });
}

export function createToolSteps(toolPlan: ToolPlan, toolResults: ToolResult[]): AgentStep[] {
  const calls = toolPlan.calls ?? [];
  return calls.map((call, index) => {
    const result = toolResults[index];
    if (!result) {
      return createAgentStep("execute_tool", "执行工具", `已请求调用 ${readableToolName(call.name)}，但没有获得返回结果。`, {
        action: { type: "tool_call", tool: call.name, args: call.args },
        status: "failed"
      });
    }

    if (!result.ok) {
      return createAgentStep("execute_tool", "执行工具", `${readableToolName(call.name)} 未完成：${result.message || result.error || "未知错误"}。`, {
        action: { type: "tool_call", tool: call.name, args: call.args },
        observation: sanitizeObservation(result),
        status: "failed"
      });
    }

    return createAgentStep("execute_tool", "执行工具", `${readableToolName(call.name)} 已完成，${summarizeToolResult(result)}。`, {
      action: { type: "tool_call", tool: call.name, args: call.args },
      observation: sanitizeObservation(result)
    });
  });
}

export function createObservationStep(state: AgentObservationState): AgentStep {
  const latest = state.observations?.slice(-3) ?? [];
  const missing = state.missing_facts ?? [];
  const summaries = latest.map((item) => item.summary).filter(Boolean);
  const detail = [
    summaries.length ? summaries.join("；") : "已整理当前执行结果。",
    missing.length ? `还缺：${missing.map(readableFactName).join("、")}。` : "需要的关键信息已基本补齐。"
  ].join(" ");

  return createAgentStep("observe_result", "观察结果", detail, {
    observation: {
      known_facts: state.known_facts,
      missing_facts: state.missing_facts,
      status: state.status
    }
  });
}

export function splitForStreaming(text: unknown): string[] {
  return String(text ?? "").match(/.{1,4}/gs) ?? [];
}

function readableToolName(name: string): string {
  const names: Record<string, string> = {
    query_business_data: "业务数据查询",
    list_my_customers: "客户列表查询",
    query_customer: "客户详情查询",
    query_order: "订单查询",
    query_sales_report: "销售报表查询",
    submit_leave_request: "请假申请提交"
  };
  return names[name] ?? name;
}

function summarizeToolResult(result: ToolResult): string {
  if (result.tool === "query_business_data") {
    const data = result.data ?? {};
    const metrics = Array.isArray(data.metrics) ? data.metrics : [];
    if (data.operation === "aggregate") return `得到 ${metrics.length} 个统计指标，匹配 ${data.total ?? 0} 条记录`;
    return `返回 ${data.rows?.length ?? 0} 条${readableResourceName(data.resource)}`;
  }
  if (result.tool === "list_my_customers") {
    const customers = Array.isArray(result.data?.customers) ? result.data.customers : [];
    return `返回 ${customers.length} 个客户`;
  }
  if (result.tool === "query_customer") return `找到客户「${result.data?.name ?? "未知"}」`;
  if (result.tool === "query_order") return `找到订单「${result.data?.id ?? "未知"}」`;
  if (result.tool === "query_sales_report") return `找到 ${result.data?.department ?? "相关部门"} 的销售报表`;
  if (result.tool === "submit_leave_request") return "业务系统已返回提交结果";
  return "已获得工具返回结果";
}

function readableResourceName(resource: unknown): string {
  if (resource === "customers") return "客户";
  if (resource === "orders") return "订单";
  if (resource === "sales_reports") return "销售报表";
  if (resource === "dealer_metrics") return "经营指标";
  if (resource === "dealer_vehicles") return "整车库存";
  if (resource === "dealer_leads") return "销售线索";
  if (resource === "dealer_sales_orders") return "销售订单";
  if (resource === "dealer_finance") return "财务流水";
  if (resource === "dealer_repair_orders") return "售后工单";
  if (resource === "dealer_warranty_claims") return "三包索赔";
  return "记录";
}

function readableFactName(name: string): string {
  const names: Record<string, string> = {
    direct_leader: "直属上级",
    direct_reports: "直属下级",
    org_profile: "组织/岗位信息",
    customer_scope: "客户范围",
    aggregate_metric: "统计指标",
    business_status: "业务状态",
    knowledge_context: "知识库依据",
    dealer_metrics: "经营指标",
    dealer_inventory_detail: "库存明细",
    dealer_lead_detail: "线索明细",
    dealer_order_detail: "订单明细",
    dealer_finance_detail: "财务明细",
    dealer_after_sales_detail: "售后明细",
    dealer_warranty_detail: "三包索赔明细"
  };
  return names[name] ?? name;
}

function sanitizeObservation(result: ToolResult | undefined): JsonObject {
  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error,
      code: result?.code,
      message: result?.message
    };
  }
  if (result.tool === "query_business_data") {
    return {
      ok: true,
      resource: result.data?.resource,
      operation: result.data?.operation,
      total: result.data?.total,
      metrics: result.data?.metrics,
      row_count: result.data?.rows?.length
    };
  }
  return {
    ok: true,
    tool: result.tool
  };
}

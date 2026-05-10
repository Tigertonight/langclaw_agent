import { summarizeUser } from "../auth/users.js";
import { planDealerEvidenceFollowUp } from "../dealer/dealer-evidence.js";
import {
  executeToolsNode,
  generateAnswerNode,
  planFollowUpToolCallsNode,
  planToolCallsNode
} from "../agent/nodes.js";
import {
  createAgentStep,
  createObservationStep,
  createPlanStep,
  splitForStreaming,
  createToolSteps
} from "./agent-events.js";
import {
  createAgentState,
  decideContinuation,
  recordPlan,
  recordToolRound,
  snapshotAgentState
} from "./agent-state.js";

export class FreeAgentLoop {
  constructor({ llm, knowledgeBase, toolRegistry }) {
    this.llm = llm;
    this.knowledgeBase = knowledgeBase;
    this.toolRegistry = toolRegistry;
    this.maxToolRounds = 3;
  }

  async run({ user, message, route, history = [], skills = [], selectedSkill, enterpriseContext, conversationContext, agentSteps }) {
    const state = createAgentState({ user, message, route, history, skills, enterpriseContext });
    let docs = [];

    const toolPlan = await planToolCallsNode({
      llm: this.llm,
      toolRegistry: this.toolRegistry,
      user,
      message,
      route,
      history,
      skills,
      selectedSkill,
      enterpriseContext,
      conversationContext
    });
    recordPlan(state, toolPlan);
    agentSteps.push(createPlanStep(toolPlan));

    const toolResults = [];
    if (toolPlan.clarification && toolPlan.calls.length === 0) {
      agentSteps.push(createAgentStep("ask_user", "需要补充信息", toolPlan.clarification));
      return { docs, toolPlan, toolResults, answer: toolPlan.clarification, agentSteps, agentState: snapshotAgentState(state) };
    }

    const previousCalls = [];
    let currentToolPlan = toolPlan;
    for (let round = 0; round < this.maxToolRounds && currentToolPlan.calls.length > 0; round += 1) {
      agentSteps.push(createAgentStep("tool_round", `第 ${round + 1} 轮执行`, describeToolRound(round, currentToolPlan)));
      const roundResults = await executeToolsNode({
        toolRegistry: this.toolRegistry,
        user,
        toolPlan: currentToolPlan
      });
      toolResults.push(...roundResults);
      previousCalls.push(...currentToolPlan.calls);
      recordToolRound(state, currentToolPlan, roundResults);
      agentSteps.push(...createToolSteps(currentToolPlan, roundResults));
      agentSteps.push(createObservationStep(state));

      if (shouldStopAfterToolRound(currentToolPlan, toolResults)) {
        decideContinuation(state, { calls: [] });
        break;
      }

      const evidenceFollowUpPlan = planDealerEvidenceFollowUp({
        message,
        route,
        agentState: snapshotAgentState(state),
        previousCalls
      });
      decideContinuation(state, evidenceFollowUpPlan);
      if (evidenceFollowUpPlan.calls?.length && state.status === "running") {
        agentSteps.push(createAgentStep("plan_evidence", "补齐证据", "长任务还缺少可引用的数据明细，继续补齐经营分析证据。", {
          action: {
            type: "tool_call",
            tools: evidenceFollowUpPlan.calls.map((call) => call.name)
          }
        }));
        currentToolPlan = evidenceFollowUpPlan;
        continue;
      }

      const followUpPlan = await planFollowUpToolCallsNode({
        llm: this.llm,
        toolRegistry: this.toolRegistry,
        user,
        message,
        route,
        history,
        toolResults,
        previousCalls,
        agentState: snapshotAgentState(state)
      });
      decideContinuation(state, followUpPlan);
      if (!followUpPlan.calls?.length) break;
      agentSteps.push(createAgentStep("plan_follow_up", "继续判断", "根据上一轮工具结果，发现还需要补充查询。", {
        action: {
          type: "tool_call",
          tools: followUpPlan.calls.map((call) => call.name)
        }
      }));
      currentToolPlan = followUpPlan;
    }

    docs = collectKnowledgeDocs(toolResults);

    const directAnswer = createDirectAnswer({ toolResults, docs });
    if (directAnswer) {
      agentSteps.push(createAgentStep("final_answer", "生成最终答复", "已使用工具的确定性结果直接组织回答。"));
      return { docs, toolPlan: { calls: previousCalls }, toolResults, answer: directAnswer.answer, artifacts: directAnswer.artifacts ?? [], agentSteps, agentState: snapshotAgentState(state) };
    }

    const generated = await generateAnswerNode({
      llm: this.llm,
      user: summarizeUser(user),
      message,
      route,
      docs,
      toolResults,
      enterpriseContext,
      conversationContext
    });

    agentSteps.push(createAgentStep("final_answer", "生成最终答复", "已结合可访问的数据、知识库片段和执行结果组织回答。"));
    return { docs, toolPlan: { calls: previousCalls }, toolResults, answer: generated.answer, artifacts: generated.artifacts ?? [], agentSteps, agentState: snapshotAgentState(state) };
  }

  async runStream({ user, message, route, history = [], skills = [], selectedSkill, enterpriseContext, conversationContext, agentSteps, emit, pushStep }) {
    const state = createAgentState({ user, message, route, history, skills, enterpriseContext });
    let docs = [];

    const toolPlan = await planToolCallsNode({
      llm: this.llm,
      toolRegistry: this.toolRegistry,
      user,
      message,
      route,
      history,
      skills,
      selectedSkill,
      enterpriseContext,
      conversationContext
    });
    recordPlan(state, toolPlan);
    await pushStep(createPlanStep(toolPlan));

    const toolResults = [];
    if (toolPlan.clarification && toolPlan.calls.length === 0) {
      await pushStep(createAgentStep("ask_user", "需要补充信息", toolPlan.clarification));
      return { docs, toolPlan, toolResults, answer: toolPlan.clarification, agentSteps, agentState: snapshotAgentState(state) };
    }

    const previousCalls = [];
    let currentToolPlan = toolPlan;
    for (let round = 0; round < this.maxToolRounds && currentToolPlan.calls.length > 0; round += 1) {
      await pushStep(createAgentStep("tool_round", `第 ${round + 1} 轮执行`, describeToolRound(round, currentToolPlan)));
      const roundResults = await executeToolsNode({
        toolRegistry: this.toolRegistry,
        user,
        toolPlan: currentToolPlan
      });
      toolResults.push(...roundResults);
      previousCalls.push(...currentToolPlan.calls);
      recordToolRound(state, currentToolPlan, roundResults);
      for (const step of createToolSteps(currentToolPlan, roundResults)) {
        await pushStep(step);
      }
      await pushStep(createObservationStep(state));

      if (shouldStopAfterToolRound(currentToolPlan, toolResults)) {
        decideContinuation(state, { calls: [] });
        break;
      }

      const evidenceFollowUpPlan = planDealerEvidenceFollowUp({
        message,
        route,
        agentState: snapshotAgentState(state),
        previousCalls
      });
      decideContinuation(state, evidenceFollowUpPlan);
      if (evidenceFollowUpPlan.calls?.length && state.status === "running") {
        await pushStep(createAgentStep("plan_evidence", "补齐证据", "长任务还缺少可引用的数据明细，继续补齐经营分析证据。", {
          action: {
            type: "tool_call",
            tools: evidenceFollowUpPlan.calls.map((call) => call.name)
          }
        }));
        currentToolPlan = evidenceFollowUpPlan;
        continue;
      }

      const followUpPlan = await planFollowUpToolCallsNode({
        llm: this.llm,
        toolRegistry: this.toolRegistry,
        user,
        message,
        route,
        history,
        toolResults,
        previousCalls,
        agentState: snapshotAgentState(state)
      });
      decideContinuation(state, followUpPlan);
      if (!followUpPlan.calls?.length) break;
      await pushStep(createAgentStep("plan_follow_up", "继续判断", "根据上一轮工具结果，发现还需要补充查询。", {
        action: {
          type: "tool_call",
          tools: followUpPlan.calls.map((call) => call.name)
        }
      }));
      currentToolPlan = followUpPlan;
    }

    docs = collectKnowledgeDocs(toolResults);
    if (docs.length) {
      await emit({ type: "sources", sources: docs.map((doc) => ({
        source: doc.metadata.source,
        title: doc.metadata.title,
        heading: doc.metadata.heading,
        score: doc.score
      })) });
    }

    const directAnswer = createDirectAnswer({ toolResults, docs });
    if (directAnswer) {
      await pushStep(createAgentStep("final_answer", "生成最终答复", "已使用工具的确定性结果直接组织回答。"));
      let streamed = "";
      for (const token of splitForStreaming(directAnswer.answer)) {
        streamed += token;
        await emit({ type: "delta", text: token });
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      return {
        docs,
        toolPlan: { calls: previousCalls },
        toolResults,
        answer: streamed || directAnswer.answer,
        artifacts: directAnswer.artifacts ?? [],
        agentSteps,
        agentState: snapshotAgentState(state),
        answerAlreadyStreamed: true
      };
    }

    await pushStep(createAgentStep("final_answer", "生成最终答复", "正在结合执行过程、工具结果和知识库内容组织回答。"));

    let answer = "";
    const generated = await this.llm.streamAnswer({
      user: summarizeUser(user),
      question: message,
      route,
      docs,
      toolResults,
      enterpriseContext,
      conversationContext
    }, {
      onToken: async (token) => {
        answer += token;
        await emit({ type: "delta", text: token });
      },
      onThinking: async ({ delta, text }) => {
        await emit({
          type: "thinking",
          model_thinking: true,
          delta,
          text,
          step: {
            phase: "model_thinking",
            title: "思考中",
            detail: text,
            status: "running"
          }
        });
      }
    });

    return {
      docs,
      toolPlan: { calls: previousCalls },
      toolResults,
      answer: generated.answer || answer,
      artifacts: generated.artifacts ?? [],
      agentSteps,
      agentState: snapshotAgentState(state),
      answerAlreadyStreamed: true
    };
  }
}

function collectKnowledgeDocs(toolResults = []) {
  const docs = [];
  const seen = new Set();
  for (const result of toolResults) {
    if (result.tool !== "retrieve_knowledge" || !result.ok) continue;
    for (const doc of result.data?.docs ?? []) {
      const key = [
        doc.metadata?.source,
        doc.metadata?.title,
        doc.metadata?.heading,
        doc.text
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      docs.push(doc);
    }
  }
  return docs;
}

function shouldStopAfterToolRound(toolPlan, toolResults) {
  const calls = toolPlan?.calls ?? [];
  if (!calls.length) return false;
  if (!calls.every((call) => TERMINAL_TOOL_NAMES.has(call.name))) return false;
  return calls.every((call) => toolResults.some((result) => result.tool === call.name && result.ok));
}

const TERMINAL_TOOL_NAMES = new Set([
  "safe_compute",
  "retrieve_knowledge"
]);

function createDirectAnswer({ toolResults = [], docs = [] }) {
  if (docs.length) return null;
  const successful = toolResults.filter((result) => result.ok);
  if (!successful.length) return null;

  if (successful.every((result) => result.tool === "safe_compute")) {
    const values = successful.map((result) => formatComputeValue(result.data?.value));
    return {
      answer: values.length === 1
        ? `计算结果：${values[0]}`
        : `计算结果：\n${values.map((value, index) => `${index + 1}. ${value}`).join("\n")}`
    };
  }

  if (successful.every((result) => result.tool === "query_business_data")) {
    return { answer: formatBusinessDataAnswer(successful) };
  }

  return null;
}

function formatBusinessDataAnswer(results) {
  return results.map((result) => formatBusinessDataResult(result.data)).filter(Boolean).join("\n\n");
}

function formatBusinessDataResult(data = {}) {
  const resourceName = readableResourceName(data.resource, data);
  if (data.operation === "aggregate") {
    const metrics = data.metrics ?? {};
    const entries = Array.isArray(metrics)
      ? metrics.map((metric) => [metric.as ?? metric.field ?? metric.type ?? "count", metric.value])
      : Object.entries(metrics);
    if (!entries.length) return `${resourceName}没有返回可用统计结果。`;
    return entries.map(([key, value]) => `${readableFieldName(data, key)}：${formatAggregateValue(data, key, value)}`).join("\n");
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) return `没有找到匹配的${resourceName}数据。`;

  const lines = [`共找到 ${data.total ?? rows.length} 条${resourceName}数据：`];
  const displayLimit = data.resource === "departments" ? 100 : 12;
  for (const [index, row] of rows.slice(0, displayLimit).entries()) {
    lines.push(`${index + 1}. ${formatBusinessRow(data, row)}`);
  }
  if (rows.length > displayLimit || Number(data.total) > rows.length) {
    lines.push(`还有更多结果，可继续缩小范围或说明你想查看的字段。`);
  }
  return lines.join("\n");
}

function formatBusinessRow(data, row) {
  const fields = pickDisplayFields(data, row);
  const parts = fields
    .filter((field) => row[field] !== undefined && row[field] !== null && row[field] !== "")
    .map((field) => `${readableFieldName(data, field)}：${formatBusinessValue(row[field])}`);
  if (data.resource === "dealer_quotas" && row.available_quota !== undefined) {
    parts.push(`剩余可承诺 ${formatBusinessValue(row.available_quota)}`);
  }
  return parts.length ? parts.join("，") : JSON.stringify(row);
}

function pickDisplayFields(data, row) {
  const preferred = {
    customers: ["name", "tier", "industry", "deal_status", "follow_status", "annual_revenue", "next_follow_up_at"],
    orders: ["customer_name", "status", "amount", "created_at", "expected_delivery"],
    sales_reports: ["department", "period", "revenue", "pipeline"],
    employees: ["name", "department_name", "position", "direct_leader_profiles", "reporting"],
    departments: ["name", "parentid", "leader_userid"],
    leave_requests: ["applicant_name", "leave_type", "leave_duration", "start_time", "end_time", "status"],
    dealer_quotas: ["store_name", "month", "series", "model", "color", "quota_total", "bound_inbound_count", "available_quota"],
    dealer_leads: ["customer_name", "source", "store_name", "owner_name", "interested_series", "intention_level", "status", "followup_count"],
    dealer_sales_orders: ["id", "customer_name", "series", "model", "order_type", "order_status", "delivery_status", "expected_delivery_date"],
    dealer_finance: ["resource_type", "store_name", "direction", "category", "amount", "balance_after", "related_order_id", "status"],
    dealer_warranty_claims: ["id", "repair_order_id", "store_name", "customer_name", "vin", "series", "claim_status", "evidence_status"],
    dealer_metrics: ["store_name", "category", "metric", "value", "unit", "severity", "summary", "recommendation"]
  };
  const fields = preferred[data.resource] ?? data.fields ?? Object.keys(row);
  return fields.filter((field) => row[field] !== undefined).slice(0, 8);
}

function readableFieldName(data, field) {
  const resourceLabels = {
    employees: {
      name: "姓名",
      department_name: "所属组织",
      position: "岗位",
      direct_leader: "直属上级",
      direct_leader_profiles: "直属上级",
      employee_count: "员工数"
    },
    departments: {
      name: "组织节点",
      parentid: "上级部门ID",
      leader_userid: "部门负责人"
    },
    customers: {
      name: "客户名"
    }
  };
  if (resourceLabels[data.resource]?.[field]) return resourceLabels[data.resource][field];
  return data.field_labels?.[field] ?? field;
}

function readableResourceName(resource, data = {}) {
  const names = {
    customers: "客户",
    orders: "订单",
    sales_reports: "销售报表",
    employees: "员工",
    departments: "组织",
    leave_requests: "请假记录",
    dealer_quotas: "配额",
    dealer_leads: "销售线索",
    dealer_sales_orders: hasDeliveryPendingFilter(data) ? "待交付销售订单" : "销售订单",
    dealer_finance: "折让金和财务流水",
    dealer_warranty_claims: "三包索赔",
    dealer_metrics: "经营指标"
  };
  return names[resource] ?? "业务";
}

function formatBusinessValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (
      item && typeof item === "object"
        ? [item.name, item.position].filter(Boolean).join(" / ")
        : String(item)
    )).join("、");
  }
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (value && typeof value === "object") {
    if (value.manager_profile?.name) return [value.manager_profile.name, value.manager_profile.position].filter(Boolean).join(" / ");
    if (value.store_manager_profile?.name) return [value.store_manager_profile.name, value.store_manager_profile.position].filter(Boolean).join(" / ");
    if (value.name) return [value.name, value.position].filter(Boolean).join(" / ");
    return JSON.stringify(value);
  }
  if (value === "discount_wallet") return "折让金";
  return String(value);
}

function formatAggregateValue(data, key, value) {
  if (data.resource === "employees" && key === "employee_count") return `${formatBusinessValue(value)} 人`;
  return formatBusinessValue(value);
}

function hasDeliveryPendingFilter(data = {}) {
  return (data.query?.filters ?? []).some((filter) => (
    filter.field === "delivery_status"
    && String(filter.value ?? "").includes("待")
  ));
}

function formatComputeValue(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "无结果";
  return JSON.stringify(value, null, 2);
}

function describeToolRound(round, toolPlan) {
  const resources = (toolPlan.calls ?? [])
    .map((call) => call.args?.resource)
    .filter(Boolean);
  const target = resources.length ? resources.join("、") : (toolPlan.calls ?? []).map((call) => call.name).join("、");
  if (round === 0) return `首轮查询核心事实：${target || "业务工具"}。`;
  return `第 ${round + 1} 轮 loop 补充缺失证据：${target || "业务工具"}。`;
}

import { businessSurface } from "./openui-bridge.js";
import { A2UI_BASIC_CATALOG_ID, A2UI_VERSION, type A2UIComponentInstance, type A2UIEnvelope } from "./types.js";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

interface BuildA2UIInput {
  result: unknown;
  surfacePrefix?: string;
}

export function buildA2UIResponse({ result, surfacePrefix = "agent" }: BuildA2UIInput): A2UIEnvelope[] {
  const record = toRecord(result);
  const output = toRecord(record.output) ?? {};
  const runId = stringOr(record.run_id, `run_${Date.now()}`);
  const messages: A2UIEnvelope[] = [];
  const pendingActions = extractPendingActions(record);
  const sources = readArray(record.sources).length ? readArray(record.sources) : readArray(output.sources);
  const trace = toRecord(record.trace) ?? {};
  const debug = toRecord(record.debug) ?? toRecord(output.debug) ?? {};
  const route = toRecord(trace.route_summary) ?? toRecord(debug.route);
  const taskRetrieval = toRecord(trace.task_retrieval);
  const taskTop = readArray(taskRetrieval?.top).filter(shouldShowTaskResume);
  const vehicleProgress = extractVehicleProgress(record);
  const expenseEstimate = extractExpenseEstimate(record);
  const leaveRequest = extractLeaveRequestForm(record);

  if (pendingActions.length) {
    messages.push(...surface({
      surfaceId: `${surfacePrefix}_${runId}_approval`,
      root: "approval_root",
      data: {
        pending_actions: pendingActions,
        steps: approvalFlowSteps(pendingActions),
        ...businessSurface("approval_flow", "审批确认流程", { pending_actions: pendingActions, steps: approvalFlowSteps(pendingActions) }, approvalActions(pendingActions))
      },
      components: approvalComponents(pendingActions)
    }));
  }

  if (taskTop.length) {
    messages.push(...surface({
      surfaceId: `${surfacePrefix}_${runId}_task_resume`,
      root: "task_resume_root",
      data: {
        task_retrieval: taskRetrieval,
        tasks: taskTop,
        ...businessSurface("task_resume", taskTop.length > 1 ? "你想继续哪个任务？" : "继续这个任务？", { tasks: taskTop }, taskResumeActions(taskTop))
      },
      components: taskResumeComponents(taskTop)
    }));
  }

  if (vehicleProgress.orders.length) {
    messages.push(...surface({
      surfaceId: `${surfacePrefix}_${runId}_vehicle_progress`,
      root: "vehicle_progress_root",
      data: {
        ...vehicleProgress,
        ...businessSurface("vehicle_progress", vehicleProgress.title, vehicleProgress)
      },
      components: vehicleProgressComponents(vehicleProgress)
    }));
  }

  if (expenseEstimate) {
    messages.push(...surface({
      surfaceId: `${surfacePrefix}_${runId}_expense_estimate`,
      root: "expense_estimate_root",
      data: {
        ...expenseEstimate,
        ...businessSurface("expense_estimate", "报销金额测算", expenseEstimate)
      },
      components: expenseEstimateComponents(expenseEstimate)
    }));
  }

  if (leaveRequest) {
    messages.push(...surface({
      surfaceId: `${surfacePrefix}_${runId}_leave_request_form`,
      root: "leave_request_root",
      data: {
        ...leaveRequest,
        ...businessSurface("leave_request_form", "请假申请", leaveRequest, leaveRequestActions(leaveRequest))
      },
      components: leaveRequestComponents(leaveRequest)
    }));
  }

  if (sources.length) {
    messages.push(...surface({
      surfaceId: `${surfacePrefix}_${runId}_sources`,
      root: "sources_root",
      data: {
        sources,
        ...businessSurface("source_citation", "引用来源", { sources })
      },
      components: sourceComponents(sources)
    }));
  }

  if (route || taskRetrieval) {
    messages.push(...surface({
      surfaceId: `${surfacePrefix}_${runId}_runtime`,
      root: "runtime_root",
      data: {
        route,
        task_retrieval: taskRetrieval,
        ...businessSurface("runtime_summary", "本轮执行摘要", { route, task_retrieval: taskRetrieval })
      },
      components: runtimeComponents({ route, taskRetrieval })
    }));
  }

  return messages;
}

function surface({ surfaceId, root, data, components }: { surfaceId: string; root: string; data: JsonObject; components: A2UIComponentInstance[] }): A2UIEnvelope[] {
  return [
    {
      version: A2UI_VERSION,
      createSurface: {
        surfaceId,
        catalogId: A2UI_BASIC_CATALOG_ID,
        root,
        sendDataModel: true,
        theme: {
          primaryColor: "#111111",
          agentDisplayName: "LangClaw"
        }
      }
    },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        value: data
      }
    },
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components
      }
    }
  ];
}

function approvalFlowSteps(actions: JsonObject[]): JsonObject[] {
  return [
    { key: "created", label: "生成待确认动作", status: "done" },
    { key: "approval", label: actions.length ? "等待用户确认" : "无需确认", status: actions.length ? "current" : "done" },
    { key: "result", label: "执行并返回结果", status: "pending" }
  ];
}

function approvalActions(actions: JsonObject[]): JsonObject[] {
  return actions.flatMap((action) => {
    const id = String(action.id ?? "");
    if (!id) return [];
    return [
      { name: "runtime.pending_action.confirm", label: "确认执行", context: { pending_action_id: id } },
      { name: "runtime.pending_action.reject", label: "拒绝", context: { pending_action_id: id } }
    ];
  });
}

function leaveRequestActions(input: JsonObject): JsonObject[] {
  return readArray(input.pending_actions).length ? approvalActions(readArray(input.pending_actions)) : [];
}

function expenseEstimateComponents(data: JsonObject): A2UIComponentInstance[] {
  return [
    card("expense_estimate_root", ["expense_estimate_title", "expense_estimate_amounts", "expense_estimate_basis"]),
    text("expense_estimate_title", "### 报销金额测算"),
    row("expense_estimate_amounts", ["expense_claimed", "expense_eligible", "expense_exceeded"]),
    text("expense_claimed", `**${formatCurrency(data.claimed_amount)}**\n\n申报金额`),
    text("expense_eligible", `**${formatCurrency(data.eligible_amount)}**\n\n预计可报`),
    text("expense_exceeded", `**${formatCurrency(data.exceeded_amount)}**\n\n超标金额`),
    text("expense_estimate_basis", `依据：${String(data.policy_basis ?? "按当前制度标准测算")}`)
  ];
}

function leaveRequestComponents(data: JsonObject): A2UIComponentInstance[] {
  return [
    card("leave_request_root", ["leave_request_title", "leave_request_slots", "leave_request_status"]),
    text("leave_request_title", "### 请假申请"),
    list("leave_request_slots", ["leave_slot_type", "leave_slot_start", "leave_slot_end", "leave_slot_reason"]),
    text("leave_slot_type", `请假类型：${String(toRecord(data.slots)?.leave_type ?? "待补充")}`),
    text("leave_slot_start", `开始时间：${String(toRecord(data.slots)?.start_time ?? "待补充")}`),
    text("leave_slot_end", `结束时间：${String(toRecord(data.slots)?.end_time ?? "待补充")}`),
    text("leave_slot_reason", `请假事由：${String(toRecord(data.slots)?.reason ?? "待补充")}`),
    text("leave_request_status", `状态：${String(data.step ?? "collecting")}；缺失：${readArrayLike(data.missing_slots).join("、") || "无"}`)
  ];
}

function approvalComponents(actions: JsonObject[]): A2UIComponentInstance[] {
  const children = actions.map((_, index) => `approval_${index}`);
  return [
    card("approval_root", ["approval_title", ...children]),
    text("approval_title", "### 待确认操作\n这些动作会修改业务数据，需要确认后执行。"),
    ...actions.flatMap((action, index) => {
      const id = String(action.id ?? "");
      const tool = String(action.tool ?? "");
      const call = toRecord(action.call);
      const callArgs = toRecord(call?.args);
      const callPreview = call ? `\n\n调用：${String(call.name ?? tool)}${callArgs ? `\n参数：${JSON.stringify(callArgs).slice(0, 260)}` : ""}` : "";
      const expiresAt = action.expires_at ? `\n\n过期时间：${String(action.expires_at)}` : "";
      return [
        card(`approval_${index}`, [`approval_${index}_text`, `approval_${index}_actions`]),
        text(`approval_${index}_text`, `**${tool}**\n\n动作 ID：${id}\n\n风险等级：${String(action.risk_level ?? "write")}\n\n${String(action.reason ?? "需要确认。")}${callPreview}${expiresAt}`),
        row(`approval_${index}_actions`, [`approval_${index}_confirm`, `approval_${index}_reject`]),
        button(`approval_${index}_confirm`, "确认执行", "runtime.pending_action.confirm", { pending_action_id: id }),
        button(`approval_${index}_reject`, "拒绝", "runtime.pending_action.reject", { pending_action_id: id })
      ];
    })
  ];
}

function taskResumeActions(tasks: JsonObject[]): JsonObject[] {
  return tasks.flatMap((task) => {
    const taskId = String(task.id ?? "");
    const taskListId = String(task.task_list_id ?? "");
    if (!taskId) return [];
    return [
      { name: "task.resume.select", label: "继续这个", context: { task_id: taskId, task_list_id: taskListId } },
      { name: "task.resume.ignore", label: "先不继续", context: { task_id: taskId, task_list_id: taskListId } }
    ];
  });
}

function taskResumeComponents(tasks: JsonObject[]): A2UIComponentInstance[] {
  const multi = tasks.length > 1;
  return [
    card("task_resume_root", ["task_resume_title", "task_resume_list"]),
    text("task_resume_title", multi ? "### 你想继续哪个任务？" : "### 继续这个任务？"),
    list("task_resume_list", tasks.map((_, index) => `task_resume_${index}`)),
    ...tasks.flatMap((task, index) => {
      const taskId = String(task.id ?? "");
      const taskListId = String(task.task_list_id ?? "");
      const subject = String(task.subject ?? task.active_form ?? taskId ?? "未命名任务");
      const detail = [
        `**${subject}**`,
        task.status ? `状态：${String(task.status)}` : "",
        task.next_action ? `下一步：${String(task.next_action)}` : "",
        task.goal ? `目标：${String(task.goal)}` : "",
        `相关度：${String(task.relevance ?? "-")}`,
        task.reason ? `召回原因：${String(task.reason)}` : ""
      ].filter(Boolean).join("\n\n");
      return [
        card(`task_resume_${index}`, [`task_resume_${index}_text`, `task_resume_${index}_actions`]),
        text(`task_resume_${index}_text`, detail),
        row(`task_resume_${index}_actions`, [`task_resume_${index}_select`, `task_resume_${index}_ignore`]),
        button(`task_resume_${index}_select`, "继续这个", "task.resume.select", { task_id: taskId, task_list_id: taskListId }),
        button(`task_resume_${index}_ignore`, "先不继续", "task.resume.ignore", { task_id: taskId, task_list_id: taskListId })
      ];
    })
  ];
}

function shouldShowTaskResume(task: JsonObject): boolean {
  const reason = String(task.reason ?? "");
  const relevance = typeof task.relevance === "number" ? task.relevance : 0;
  return relevance >= 0.3 || reason.includes("continue") || reason.includes("keyword");
}

function vehicleProgressComponents(data: { title: string; summary: JsonObject; orders: JsonObject[] }): A2UIComponentInstance[] {
  return [
    card("vehicle_progress_root", ["vehicle_progress_title", "vehicle_progress_summary", "vehicle_progress_list"]),
    text("vehicle_progress_title", `### ${data.title}`),
    row("vehicle_progress_summary", ["vehicle_progress_total", "vehicle_progress_pending", "vehicle_progress_unpaid"]),
    text("vehicle_progress_total", `**${String(data.summary.total ?? 0)}**\n\n相关订单`),
    text("vehicle_progress_pending", `**${String(data.summary.pending_delivery ?? 0)}**\n\n待交付/整备`),
    text("vehicle_progress_unpaid", `**${String(data.summary.unpaid ?? 0)}**\n\n未结清`),
    list("vehicle_progress_list", data.orders.map((_, index) => `vehicle_order_${index}`)),
    ...data.orders.flatMap((order, index) => {
      const customer = String(order.customer_name ?? "客户");
      const model = [order.series, order.model].filter(Boolean).join(" ");
      const delivery = String(order.delivery_status ?? order.order_status ?? "-");
      const payment = String(order.payment_status ?? "-");
      const expected = String(order.expected_delivery_date ?? "-");
      const paid = formatCurrency(order.paid_amount);
      const finalPrice = formatCurrency(order.final_price);
      const nextAction = nextVehicleAction(order);
      return [
        card(`vehicle_order_${index}`, [`vehicle_order_${index}_body`, `vehicle_order_${index}_action`]),
        text(`vehicle_order_${index}_body`, [
          `**${customer}${model ? ` · ${model}` : ""}**`,
          `订单：${String(order.id ?? "-")} · 交付：${delivery} · 收款：${payment}`,
          `预计交付：${expected} · 已收：${paid} / ${finalPrice}`
        ].join("\n\n")),
        text(`vehicle_order_${index}_action`, `下一步：${nextAction}`)
      ];
    })
  ];
}

function extractVehicleProgress(record: Record<string, unknown>): { title: string; summary: JsonObject; orders: JsonObject[] } {
  const output = toRecord(record.output) ?? {};
  const table = toRecord(record.table) ?? toRecord(output.table);
  const debug = toRecord(record.debug) ?? toRecord(output.debug) ?? {};
  const toolCall = toRecord(debug.tool_call);
  const args = toRecord(toolCall?.args);
  const toolData = extractDealerSalesOrderToolData(debug);
  const rows = readArray(table?.rows).length ? readArray(table?.rows) : toolData.rows;
  const resource = String(args?.resource ?? toolData.resource ?? inferResourceFromRows(rows));
  if (resource !== "dealer_sales_orders" || !rows.length) {
    return { title: "", summary: { total: 0 }, orders: [] };
  }
  const orders = rows.slice(0, 6);
  return {
    title: "车辆交付进度",
    summary: {
      total: toolData.total ?? rows.length,
      pending_delivery: rows.filter(isPendingVehicleDelivery).length,
      unpaid: rows.filter((row) => String(row.payment_status ?? "") !== "已结清").length
    },
    orders: orders.map((order) => ({
      ...order,
      timeline: vehicleTimeline(order)
    }))
  };
}

function vehicleTimeline(order: JsonObject): JsonObject[] {
  const paid = String(order.payment_status ?? "") === "已结清";
  const invoiced = String(order.invoice_status ?? "") === "已开票";
  const delivered = String(order.delivery_status ?? "") === "已交付";
  return [
    { key: "order", label: "订单创建", status: "done" },
    { key: "payment", label: "收款确认", status: paid ? "done" : "current" },
    { key: "invoice", label: "开票", status: paid ? (invoiced ? "done" : "current") : "pending" },
    { key: "delivery", label: "交付", status: delivered ? "done" : invoiced ? "current" : "pending" }
  ];
}

function extractExpenseEstimate(record: Record<string, unknown>): JsonObject | null {
  const output = toRecord(record.output) ?? {};
  const answer = String(record.answer ?? output.answer ?? "");
  const message = String(record.user_message ?? output.user_message ?? "");
  const combined = `${message}\n${answer}`;
  if (!/报销|差旅|住宿|酒店|发票/.test(combined)) return null;
  const claimed = extractMoney(message) ?? extractMoney(answer);
  if (!claimed) return null;
  const standard = /一线|北京|上海|广州|深圳/.test(combined) || /北京|上海|广州|深圳/.test(message) ? 600 : 450;
  const eligible = Math.min(claimed, standard);
  const exceeded = Math.max(0, claimed - standard);
  return {
    claimed_amount: claimed,
    eligible_amount: eligible,
    exceeded_amount: exceeded,
    currency: "CNY",
    policy_basis: `住宿标准 ${standard} 元/晚；超标部分需说明并审批。`,
    status: exceeded > 0 ? "exceeded" : "eligible"
  };
}

function extractLeaveRequestForm(record: Record<string, unknown>): JsonObject | null {
  const output = toRecord(record.output) ?? {};
  const debug = toRecord(record.debug) ?? toRecord(output.debug) ?? {};
  const scenario = toRecord(debug.scenario);
  const answer = String(record.answer ?? output.answer ?? "");
  const message = String(record.user_message ?? output.user_message ?? "");
  if (!/(请假|休假|年假|病假|事假|调休)/.test(`${message}\n${answer}`) && scenario?.scenario !== "leave_request") return null;
  const slots = {
    ...extractLeaveSlotsFromText(answer),
    ...extractLeaveSlotsFromText(message)
  };
  const missing = readArrayLike(scenario?.missing_slots).length
    ? readArrayLike(scenario?.missing_slots)
    : inferMissingLeaveSlots(slots);
  const step = String(scenario?.step ?? (missing.length ? "collecting" : /确认是否提交/.test(answer) ? "awaiting_confirmation" : /已提交/.test(answer) ? "completed" : "collecting"));
  return {
    step,
    slots,
    missing_slots: missing,
    completion: Math.round(((4 - missing.length) / 4) * 100)
  };
}

function extractLeaveSlotsFromText(text: string): JsonObject {
  const slots: JsonObject = {};
  const type = text.match(/(?:类型|请假类型)[：:]\s*([^\n，,]+)/)?.[1] ?? text.match(/(年假|病假|事假|调休)/)?.[1];
  const start = text.match(/(?:开始|开始时间)[：:]\s*([^\n，,]+)/)?.[1];
  const end = text.match(/(?:结束|结束时间)[：:]\s*([^\n，,]+)/)?.[1] ?? text.match(/(?:结束时间|结束|请假时长|leave_duration)[：:]\s*([^\n，,]+)/)?.[1];
  const reason = text.match(/(?:事由|请假事由|理由|reason)[：:]\s*([^\n]+)/)?.[1] ?? text.match(/(?:因为|原因是|事由是)([^\n]+)/)?.[1];
  if (type) slots.leave_type = type.trim();
  if (start) slots.start_time = start.trim();
  if (end) slots.end_time = end.trim();
  if (reason) slots.reason = reason.trim();
  return slots;
}

function inferMissingLeaveSlots(slots: JsonObject): string[] {
  return ["leave_type", "start_time", "end_time", "reason"].filter((key) => !slots[key]);
}

function extractMoney(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|人民币)?/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractDealerSalesOrderToolData(debug: JsonObject): { resource?: string; total?: number; rows: JsonObject[] } {
  const toolResults = readArray(debug.tool_results);
  for (const result of toolResults) {
    const resource = String(result.resource ?? toRecord(result.data)?.resource ?? "");
    if (resource !== "dealer_sales_orders") continue;
    const data = toRecord(result.data);
    const rows = readArray(result.rows).length
      ? readArray(result.rows)
      : readArray(result.sample_rows).length
        ? readArray(result.sample_rows)
        : readArray(data?.rows).length
          ? readArray(data?.rows)
          : readArray(data?.sample_rows);
    return {
      resource,
      total: typeof result.total === "number" ? result.total : typeof data?.total === "number" ? data.total : undefined,
      rows
    };
  }
  return { rows: [] };
}

function inferResourceFromRows(rows: JsonObject[]): string {
  if (rows.some((row) => row.delivery_status != null && row.payment_status != null && row.expected_delivery_date != null)) {
    return "dealer_sales_orders";
  }
  return "";
}

function isPendingVehicleDelivery(order: JsonObject): boolean {
  const orderStatus = String(order.order_status ?? "");
  const deliveryStatus = String(order.delivery_status ?? "");
  return orderStatus !== "已交付" || deliveryStatus !== "已交付";
}

function nextVehicleAction(order: JsonObject): string {
  const payment = String(order.payment_status ?? "");
  const invoice = String(order.invoice_status ?? "");
  const delivery = String(order.delivery_status ?? "");
  if (payment !== "已结清") return "优先跟进尾款/金融放款到账";
  if (invoice !== "已开票") return "确认开票节点";
  if (delivery !== "已交付") return "确认整备、上牌和交付排期";
  return "已完成交付，保持客户回访";
}

function formatCurrency(value: unknown): string {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `${Math.round(amount).toLocaleString("zh-CN")} 元`;
}

function sourceComponents(sources: JsonObject[]): A2UIComponentInstance[] {
  return [
    card("sources_root", ["sources_title", "sources_list"]),
    text("sources_title", "### 引用来源"),
    list("sources_list", sources.map((_, index) => `source_${index}`)),
    ...sources.map((source, index) => text(
      `source_${index}`,
      [
        `**${String(source.title ?? "来源")} / ${String(source.heading ?? "")}**`,
        source.source ? `来源：${String(source.source)}` : "",
        typeof source.score === "number" ? `相关度：${source.score.toFixed(2)}` : "",
        String(source.quote ?? "").slice(0, 260)
      ].filter(Boolean).join("\n\n")
    ))
  ];
}

function runtimeComponents({ route, taskRetrieval }: { route?: JsonObject | null; taskRetrieval?: JsonObject | null }): A2UIComponentInstance[] {
  const taskTop = Array.isArray(taskRetrieval?.top) ? taskRetrieval.top as JsonObject[] : [];
  const children = ["runtime_title", "runtime_route"];
  if (taskTop.length) children.push("runtime_tasks");
  return [
    card("runtime_root", children),
    text("runtime_title", "### 本轮执行摘要"),
    text("runtime_route", [
      `路由：${String(route?.intent_code ?? "unknown")}`,
      `执行：${String(route?.execution_class ?? "-")} / ${String(route?.handler_type ?? "-")}`,
      `置信度：${String(route?.confidence ?? "-")}`
    ].join("\n")),
    ...(taskTop.length ? [
      list("runtime_tasks", taskTop.map((_, index) => `runtime_task_${index}`)),
      ...taskTop.map((task, index) => text(`runtime_task_${index}`, `${String(task.id ?? "")} · ${String(task.status ?? "")} · relevance=${String(task.relevance ?? "-")}`))
    ] : [])
  ];
}

function card(id: string, children: string[]): A2UIComponentInstance {
  return { id, component: { Card: { children } } };
}

function row(id: string, children: string[]): A2UIComponentInstance {
  return { id, component: { Row: { children } } };
}

function list(id: string, children: string[]): A2UIComponentInstance {
  return { id, component: { List: { children } } };
}

function text(id: string, value: string): A2UIComponentInstance {
  return { id, component: { Text: { text: { literalString: value } } } };
}

function button(id: string, label: string, actionName: string, context: JsonObject): A2UIComponentInstance {
  return {
    id,
    component: {
      Button: {
        text: { literalString: label },
        action: {
          event: {
            name: actionName,
            context
          }
        }
      }
    }
  };
}

function extractPendingActions(record: Record<string, unknown>): JsonObject[] {
  const output = toRecord(record.output);
  const candidates = [
    ...normalizePendingActions(record.pending_actions),
    ...normalizePendingActions(toRecord(output)?.pending_actions),
    ...extractFromToolResults(record.tool_results),
    ...extractFromToolResults(toRecord(record.debug)?.tool_results),
    ...extractFromToolResults(toRecord(output)?.debug && toRecord(toRecord(output)?.debug)?.tool_results)
  ];
  return uniqueById(candidates);
}

function normalizePendingActions(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.map(toRecord).filter((item): item is JsonObject => Boolean(item?.id));
}

function extractFromToolResults(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toRecord)
    .filter((item): item is JsonObject => Boolean(item?.error === "confirmation_required" && toRecord(item.data)?.pending_action_id))
    .map((item) => {
      const data = toRecord(item.data) ?? {};
      return {
        id: data.pending_action_id,
        tool: data.tool ?? item.tool,
        risk_level: data.risk_level ?? "write",
        expires_at: data.expires_at,
        reason: item.message ?? "需要用户确认后才能执行。",
        call: data.call
      };
    });
}

function uniqueById(items: JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = String(item.id ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function toRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function readArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(toRecord).filter((item): item is JsonObject => Boolean(item)) : [];
}

function readArrayLike(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).filter(Boolean) : [];
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

export function buildConversationContext({ session, currentMessage, enterpriseContext }) {
  const history = Array.isArray(session?.history) ? session.history : [];
  const previousTurns = toTurns(history).slice(-6);
  const lastTask = findLastTask(previousTurns, history);
  const current = analyzeCurrentMessage(currentMessage, lastTask);

  return {
    runtime: enterpriseContext?.runtime ?? null,
    session: {
      id: session?.id,
      status: session?.status,
      active_intent: session?.active_intent ?? null,
      active_skill: session?.active_skill ?? null,
      scenario: summarizeScenario(session?.scenario)
    },
    current_message: current,
    recent_messages: history.slice(-10).map((item, index) => ({
      messageId: item.messageId ?? item.id ?? `history-${index + 1}`,
      role: item.role,
      text: summarizeText(item.text)
    })),
    previous_turns: previousTurns.map(summarizeTurn),
    last_task: lastTask,
    continuation: {
      is_likely_continuation: current.is_likely_continuation,
      reason: current.continuation_reason,
      candidate_task: current.is_likely_continuation ? lastTask : null
    }
  };
}

export function summarizeConversationContext(context) {
  if (!context) return null;
  return {
    session: context.session,
    current_message: context.current_message,
    last_task: context.last_task,
    continuation: context.continuation,
    previous_turns: context.previous_turns?.slice(-3)
  };
}

function toTurns(history) {
  const turns = [];
  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    if (item.role !== "user") continue;
    const assistant = history.slice(index + 1).find((next) => next.role === "assistant");
    turns.push({
      user: item,
      assistant,
      metadata: assistant?.metadata ?? item.metadata ?? null
    });
  }
  return turns;
}

function findLastTask(turns, history) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const task = taskFromMetadata(turns[index].metadata);
    if (task) return task;
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const task = inferTaskFromText(history[index].text);
    if (task) return task;
  }
  return null;
}

function taskFromMetadata(metadata) {
  if (!metadata?.route && !metadata?.selected_skill && !metadata?.tool_calls?.length) return null;
  const firstBusinessCall = metadata.tool_calls?.find((call) => call.name === "query_business_data");
  return {
    intent: metadata.route?.intent ?? null,
    intent_code: metadata.route?.intent_code ?? null,
    selected_skill: metadata.selected_skill ?? null,
    target: firstBusinessCall?.args?.resource ?? null,
    operation: firstBusinessCall?.args?.operation ?? null,
    filters: firstBusinessCall?.args?.filters ?? [],
    summary: metadata.answer_summary ?? null
  };
}

function inferTaskFromText(text) {
  const value = String(text ?? "");
  if (/(制度|政策|流程|规则|标准|手册|报销|试用期)/.test(value)) {
    return {
      intent: "knowledge_qa",
      intent_code: "knowledge.policy_qa",
      selected_skill: "knowledge-qa",
      target: null,
      operation: null,
      filters: [],
      summary: summarizeText(value)
    };
  }
  if (/(请假记录|请假历史|休假记录|休假历史|请假数据|休假数据)/.test(value)) {
    return {
      intent: "data_query",
      intent_code: "attendance.leave_query",
      selected_skill: "leave-records",
      target: "leave_requests",
      operation: "search",
      filters: [],
      summary: summarizeText(value)
    };
  }
  if (/(客户|订单|销售额|成交额|pipeline|报表)/i.test(value)) {
    return {
      intent: "data_query",
      intent_code: "business.query",
      selected_skill: "business-query",
      target: null,
      operation: "search",
      filters: [],
      summary: summarizeText(value)
    };
  }
  if (/(组织架构|部门|员工|下属|上级|汇报关系)/.test(value)) {
    return {
      intent: "data_query",
      intent_code: "org.employee_query",
      selected_skill: "business-query",
      target: "employees",
      operation: "search",
      filters: [],
      summary: summarizeText(value)
    };
  }
  return null;
}

function analyzeCurrentMessage(message, lastTask) {
  const text = String(message ?? "").trim();
  const hasStandaloneTask = /(请假|休假|客户|订单|成交额|pipeline|报表|组织架构|员工|知识库|制度|政策|流程|规则|标准|手册|报销|试用期)/.test(text);
  const hasRefinementSignal = /(全公司|整个公司|公司全员|所有|全部|最近|近\d+|近[一二两三四五六七八九十]+|本月|上月|今天|昨天|明天|这个月|三个月|半年|一年|按|只看|筛选|换成|改成|范围|时间)/.test(text);
  const isShort = text.length > 0 && text.length <= 24;
  const isLikelyContinuation = Boolean(lastTask) && !hasStandaloneTask && (hasRefinementSignal || isShort);
  return {
    text,
    is_likely_continuation: isLikelyContinuation,
    continuation_reason: isLikelyContinuation
      ? "当前消息更像是在补充范围、时间或筛选条件，应结合 last_task 理解。"
      : "当前消息可独立理解。"
  };
}

function summarizeTurn(turn) {
  return {
    user: summarizeText(turn.user?.text),
    assistant: summarizeText(turn.assistant?.text),
    task: taskFromMetadata(turn.metadata) ?? inferTaskFromText(`${turn.user?.text ?? ""}\n${turn.assistant?.text ?? ""}`)
  };
}

function summarizeScenario(scenario) {
  if (!scenario) return null;
  return {
    intent: scenario.intent,
    step: scenario.step,
    slots: scenario.slots
  };
}

function summarizeText(text, maxLength = 300) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

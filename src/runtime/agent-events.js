export function createSources(docs) {
  return docs.map((doc) => ({
    source: doc.metadata.source,
    title: doc.metadata.title,
    heading: doc.metadata.heading,
    score: doc.score
  }));
}

export function createAgentStep(phase, title, detail, extra = {}) {
  return {
    phase,
    title,
    detail,
    status: "completed",
    at: new Date().toISOString(),
    ...extra
  };
}

export function createSkillStep(skills) {
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
          path: skill.path,
          description: skill.description
        }))
      }
    }
  );
}

export function createKnowledgeStep(docs) {
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

export function createPlanStep(toolPlan) {
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

export function createToolSteps(toolPlan, toolResults) {
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

export function createObservationStep(state) {
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

export function splitForStreaming(text) {
  return String(text ?? "").match(/.{1,8}/gs) ?? [];
}

function readableToolName(name) {
  const names = {
    query_business_data: "业务数据查询",
    list_my_customers: "客户列表查询",
    query_customer: "客户详情查询",
    query_order: "订单查询",
    query_sales_report: "销售报表查询",
    submit_leave_request: "请假申请提交"
  };
  return names[name] ?? name;
}

function summarizeToolResult(result) {
  if (result.tool === "query_business_data") {
    const data = result.data ?? {};
    if (data.operation === "aggregate") return `得到 ${data.metrics?.length ?? 0} 个统计指标，匹配 ${data.total ?? 0} 条记录`;
    return `返回 ${data.rows?.length ?? 0} 条${readableResourceName(data.resource)}`;
  }
  if (result.tool === "list_my_customers") return `返回 ${result.data?.customers?.length ?? 0} 个客户`;
  if (result.tool === "query_customer") return `找到客户「${result.data?.name ?? "未知"}」`;
  if (result.tool === "query_order") return `找到订单「${result.data?.id ?? "未知"}」`;
  if (result.tool === "query_sales_report") return `找到 ${result.data?.department ?? "相关部门"} 的销售报表`;
  if (result.tool === "submit_leave_request") return "业务系统已返回提交结果";
  return "已获得工具返回结果";
}

function readableResourceName(resource) {
  if (resource === "customers") return "客户";
  if (resource === "orders") return "订单";
  if (resource === "sales_reports") return "销售报表";
  return "记录";
}

function readableFactName(name) {
  const names = {
    direct_leader: "直属上级",
    direct_reports: "直属下级",
    org_profile: "组织/岗位信息",
    customer_scope: "客户范围",
    aggregate_metric: "统计指标",
    business_status: "业务状态",
    knowledge_context: "知识库依据"
  };
  return names[name] ?? name;
}

function sanitizeObservation(result) {
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

import { loadJson } from "../data/load-json.js";
import { composeDealerReport } from "../dealer/dealer-report-composer.js";
import { inferIntentCode } from "../agent/intent-codes.js";
import { INTENT_CODES, INTENTS } from "../agent/ports.js";
import { compileBusinessQueryIR } from "../query/query-compiler.js";
import {
  isBusinessDataQuestion,
  isCustomerQuestion,
  isDealerAnalysisQuestion,
  isLeaveRecordQuestion,
  isOrderQuestion,
  isOrgQuestion,
  isSalesReportQuestion,
  planDealerMultiQuery,
  parseBusinessQuery
} from "../query/query-parser.js";

const DATA_KEYWORDS = ["客户", "订单", "成交额", "销售额", "报表", "pipeline", "合同金额", "发货", "交付", "状态", "进展", "列表", "名下", "负责", "多少", "几个", "数量", "签单", "续签", "跟进", "行业", "组织", "组织架构", "部门", "上级", "下级", "下属", "下辖", "下面", "团队", "同学", "汇报", "直属", "领导", "主管", "岗位", "VIN", "整车", "车辆", "库存", "库龄", "在途", "配额", "PDI", "合格证", "线索", "意向", "到店", "战败", "漏斗", "锁车", "折让金", "应付", "应收", "返利", "售后", "维修", "保养", "工单", "三包", "质保", "索赔", "经营", "分析", "风险", "总览", "周报", "日报", "复盘", "看板", "优先级", "总经理", "体系", "晨会", "行动项", "经营计划", "负责人", "管理动作", "协调问题"];
const KB_KEYWORDS = ["制度", "政策", "流程", "标准", "手册", "报销", "试用期", "年假", "权限", "审批", "规则"];
const DANGEROUS_KEYWORDS = ["忽略", "绕过", "导出所有", "全部客户", "所有客户", "工资", "身份证", "银行卡"];
const LEAVE_KEYWORDS = ["请假", "休假", "年假", "病假", "事假", "调休"];

export class LocalLLMClient {
  async recognizeIntent({ user, question, history = [], conversationContext }) {
    const route = await this.classifyIntent({ user, question, history, conversationContext });
    return {
      ...route,
      intent_code: conversationContext?.continuation?.is_likely_continuation && conversationContext?.last_task?.intent_code
        ? conversationContext.last_task.intent_code
        : inferIntentCode({ intent: route.intent, message: question }),
      query_ir: null,
      router: "local"
    };
  }

  async classifyIntent({ question, history = [], conversationContext }) {
    if (conversationContext?.continuation?.is_likely_continuation && conversationContext?.last_task?.intent) {
      return {
        intent: conversationContext.last_task.intent,
        confidence: 0.88,
        reason: "当前消息是对上一轮任务的范围、时间或筛选条件补充。"
      };
    }
    const hasData = DATA_KEYWORDS.some((word) => question.includes(word)) || isDealerAnalysisQuestion(question) || await isBusinessDataQuestion(question);
    const hasKb = KB_KEYWORDS.some((word) => question.includes(word));
    const hasCompute = isComputeQuestion(question);
    const hasLeave = isLeaveIntent(question);
    const asksLeaveRecords = isLeaveRecordQuestion(question);
    const risky = DANGEROUS_KEYWORDS.some((word) => question.includes(word));
    const asksLeavePolicy = isLeavePolicyQuestion(question);
    const hasOrgData = await isOrgDataQuestion(question);

    if (/^(你好|hi|hello|在吗)/i.test(question.trim())) {
      return { intent: INTENTS.SMALLTALK, confidence: 0.95, reason: "问候类问题" };
    }
    if (asksLeavePolicy) {
      return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.88, reason: "询问请假制度或办理规则" };
    }
    if (asksLeaveRecords) {
      return { intent: INTENTS.DATA_QUERY, confidence: 0.9, reason: "查询请假记录、请假统计或团队请假情况" };
    }
    if (hasKb && !hasExplicitDataLookup(question)) {
      return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.86, reason: "涉及制度、流程或知识库内容" };
    }
    if (hasLeave) {
      return { intent: INTENTS.LEAVE_REQUEST, confidence: 0.9, reason: "涉及请假申请业务场景" };
    }
    if (risky && !hasData && !hasKb) {
      return { intent: INTENTS.UNSUPPORTED, confidence: 0.85, reason: "可能涉及敏感或越权请求" };
    }
    if (hasCompute && !hasKb) {
      return { intent: INTENTS.DATA_QUERY, confidence: 0.88, reason: "需要使用受限计算沙箱完成确定性运算" };
    }
    if ((hasData || hasOrgData) && hasKb) {
      return { intent: INTENTS.MIXED, confidence: 0.82, reason: "同时涉及业务数据和制度解释" };
    }
    if (hasData || hasOrgData) {
      if (hasOrgData) {
        return { intent: INTENTS.DATA_QUERY, confidence: 0.86, reason: "涉及企业通讯录、组织架构或人员汇报关系" };
      }
      return { intent: INTENTS.DATA_QUERY, confidence: 0.86, reason: "涉及客户、订单或销售报表" };
    }
    if (hasKb) {
      return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.86, reason: "涉及制度、流程或知识库内容" };
    }
    return { intent: INTENTS.KNOWLEDGE_QA, confidence: 0.55, reason: "默认优先检索知识库" };
  }

  async planToolCalls({ user, question, history = [], route, conversationContext }) {
    if (isComputeQuestion(question)) {
      return {
        calls: [{
          name: "safe_compute",
          args: buildSafeComputeArgs(question)
        }]
      };
    }

    if (isPersonalCustomerOverviewQuestion(question)) {
      return buildPersonalCustomerOverviewPlan();
    }

    if (shouldRetrieveKnowledge({ question, route })) {
      return buildKnowledgeRetrievalPlan(question);
    }

    const dealerIRs = await planDealerMultiQuery({ question });
    if (dealerIRs?.length > 1) {
      const plans = await Promise.all(dealerIRs.map((queryIR) => compileBusinessQueryIR(queryIR, { question })));
      return {
        calls: plans.flatMap((plan) => plan.calls ?? []),
        ir: dealerIRs
      };
    }
    const ir = route?.query_ir ?? await parseBusinessQuery({ user, question, history, conversationContext });
    if (!ir) return { calls: [] };
    return compileBusinessQueryIR(ir, { question });
  }

  async planToolCallsFromIR({ queryIR, question }) {
    if (!queryIR) return { calls: [] };
    return compileBusinessQueryIR(queryIR, { question });
  }

  async planFollowUpToolCalls({ question, previousCalls = [] }) {
    const calls = [];
    const employeeName = await extractEmployeeName(question);
    if (employeeName) return { calls };

    const asksSubordinates = ["下属", "下级", "下辖", "下面", "团队", "同学"].some((word) => question.includes(word));
    const asksLeader = ["上级", "汇报", "直属", "领导", "主管"].some((word) => question.includes(word));

    if (asksLeader && !hasEmployeeSelfQuery(previousCalls)) {
      calls.push(buildEmployeeQueryCall({
        filters: [{ field: "userid", op: "eq", value: "__CURRENT_USER__" }],
        asksAggregate: false,
        limit: 1
      }));
    }

    if (asksSubordinates && !hasSubordinateQuery(previousCalls)) {
      calls.push(buildEmployeeQueryCall({
        filters: [{ field: "direct_leader", op: "contains", value: "__CURRENT_USER__" }],
        asksAggregate: false,
        limit: 50
      }));
    }

    return { calls };
  }

  async decideNextAction({ question, route, history = [], conversationContext, user, state, toolResults = [], previousCalls = [] }) {
    if (!previousCalls.length && !toolResults.length) {
      const plan = await this.planToolCalls({ user, question, history, route, conversationContext });
      if (plan.clarification && !plan.calls?.length) {
        return {
          decision_source: "local",
          thought_summary: "当前信息不足，需要先向用户追问。",
          reason: plan.clarification,
          action: {
            type: "ask_user",
            question: plan.clarification
          }
        };
      }
      if (plan.calls?.length) {
        return {
          decision_source: "local",
          thought_summary: "先调用工具获取回答所需的事实依据。",
          reason: plan.reason ?? "本地规划判断需要补充工具结果。",
          action: {
            type: "tool_call",
            tools: plan.calls
          },
          plan_update: plan.ir ? [`查询 ${Array.isArray(plan.ir) ? plan.ir.length : 1} 组结构化数据`] : undefined
        };
      }
    }

    const followUp = await this.planFollowUpToolCalls({ question, previousCalls, toolResults, route, agentState: state });
    if (followUp.calls?.length) {
      return {
        decision_source: "local",
        thought_summary: "观察上一轮结果后，仍需要补充查询。",
        reason: followUp.reason ?? "上一轮结果还不足以完整回答。",
        action: {
          type: "tool_call",
          tools: followUp.calls
        }
      };
    }

    return {
      decision_source: "local",
      thought_summary: "已有信息可以进入回答阶段。",
      reason: "没有发现新的必要工具动作。",
      action: {
        type: "answer"
      }
    };
  }

  async generateAnswer({ question, route, docs, toolResults, agentState }) {
    if (route.intent === INTENTS.SMALLTALK) {
      return { answer: "你好，我可以帮你查询权限范围内的企业数据，也可以回答知识库里的制度和流程问题。" };
    }

    const denied = toolResults.find((result) => result.ok === false && result.error === "permission_denied");
    if (denied) {
      return { answer: denied.message };
    }

    const notFound = toolResults.find((result) => result.ok === false && result.error === "not_found");
    if (notFound && docs.length === 0) {
      return { answer: `${notFound.message}目前没有足够上下文继续判断。` };
    }

    const lines = [];
    const successfulTools = toolResults.filter((result) => result.ok);
    const dealerAnalysisAnswer = composeDealerReport({ question, route, toolResults: successfulTools });
    if (dealerAnalysisAnswer) {
      return dealerAnalysisAnswer;
    }
    const customerOrderRiskAnswer = composeCustomerOrderRiskAnswer({ question, toolResults: successfulTools, agentState });
    if (customerOrderRiskAnswer) return customerOrderRiskAnswer;
    for (const result of successfulTools) {
      if (result.tool === "query_order") {
        const order = result.data;
        lines.push(`客户「${order.customer_name}」最近订单 ${order.id} 当前状态为「${order.status}」，金额 ${order.amount} 元。`);
        if (order.expected_delivery) {
          lines.push(`预计交付时间是 ${order.expected_delivery}。`);
        }
      }
      if (result.tool === "query_customer") {
        const customer = result.data;
        lines.push(`客户「${customer.name}」属于 ${customer.tier} 类客户，行业为${customer.industry}，年度成交额为 ${customer.annual_revenue} 元。`);
      }
      if (result.tool === "list_my_customers") {
        const customers = result.data.customers;
        if (customers.length === 0) {
          lines.push("你当前没有可访问的客户。");
        } else {
          lines.push(`你当前可访问 ${customers.length} 个客户：`);
          for (const customer of customers) {
            lines.push(`- ${customer.name}（${customer.id}）：${customer.tier} 类客户，行业为${customer.industry}，年度成交额 ${customer.annual_revenue} 元。`);
          }
        }
      }
      if (result.tool === "query_sales_report") {
        const report = result.data;
        lines.push(`${report.department} 在 ${report.period} 的销售收入为 ${report.revenue} 元，pipeline 为 ${report.pipeline} 元。`);
      }
      if (result.tool === "query_business_data") {
        lines.push(formatBusinessDataResult(result.data));
      }
      if (result.tool === "safe_compute") {
        lines.push(formatSafeComputeResult(result.data));
      }
    }

    if (docs.length > 0) {
      const best = chooseAnswerChunk(docs, question);
      const summary = summarizeChunk(best.text, question);
      if (summary) lines.push(summary);
    }

    if (lines.length === 0) {
      return { answer: "我没有在可访问的数据或知识库中找到足够依据，暂时无法确认。" };
    }

    const sourceText = docs.length > 0
      ? `\n\n参考来源：${docs.map((doc) => `${doc.metadata.title} / ${doc.metadata.heading}`).join("；")}`
      : "";

    return { answer: `${lines.join("\n")}${sourceText}` };
  }

  async streamAnswer(input, { onToken } = {}) {
    const result = await this.generateAnswer(input);
    for (const token of splitForStreaming(result.answer)) {
      await onToken?.(token);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    return result;
  }
}

function isLeavePolicyQuestion(question) {
  const hasLeave = isLeaveIntent(question);
  if (!hasLeave) return false;
  return ["怎么", "如何", "制度", "政策", "流程", "规则", "标准", "说明", "问下", "了解"].some((word) => question.includes(word));
}

function isComputeQuestion(question) {
  const text = String(question ?? "");
  if (/(计算|算一下|求一下|运算|百分比|比例|平均|均值|总和|合计|四舍五入|保留\d+位|平方|开方|方差|标准差)/.test(text)) return true;
  return /(\d+(?:\.\d+)?)\s*[-+*/%^]\s*(\d+(?:\.\d+)?)/.test(text);
}

function buildSafeComputeArgs(question) {
  const expression = extractMathExpression(question);
  if (expression) {
    return {
      mode: "expression",
      code: expression,
      timeout_ms: 1000
    };
  }

  return {
    mode: "script",
    code: [
      "const text = input.question;",
      "const numbers = String(text).match(/-?\\d+(?:\\.\\d+)?/g)?.map(Number) ?? [];",
      "result = { numbers, count: numbers.length, sum: numbers.reduce((a, b) => a + b, 0), average: numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null };"
    ].join("\n"),
    input: { question },
    timeout_ms: 1000
  };
}

function isPersonalCustomerOverviewQuestion(question) {
  const text = String(question ?? "");
  const mentionsOwnedCustomers = /(\u6211\u7684|\u540d\u4e0b|\u8d1f\u8d23|\u6211\u8d1f\u8d23).{0,10}\u5ba2\u6237/.test(text)
    || /\u5ba2\u6237.{0,10}(\u6211\u7684|\u540d\u4e0b|\u8d1f\u8d23|\u6211\u8d1f\u8d23)/.test(text);
  const asksForActionableReview = /(\u8ba2\u5355|\u8ddf\u8fdb|\u4f18\u5148|\u6700\u8fd1|\u60c5\u51b5|\u98ce\u9669|\u7eed\u7b7e|\u5f85\u8ddf\u8fdb|\u770b\u770b|\u68c0\u67e5|\u5206\u6790)/.test(text);
  return mentionsOwnedCustomers && asksForActionableReview;
}

function buildPersonalCustomerOverviewPlan() {
  return {
    calls: [
      {
        name: "query_business_data",
        args: {
          resource: "customers",
          operation: "search",
          filters: [],
          metrics: [],
          fields: [
            "id",
            "name",
            "tier",
            "industry",
            "industry_category",
            "deal_status",
            "follow_status",
            "renewal_status",
            "annual_revenue",
            "last_contacted_at",
            "next_follow_up_at",
            "contract_expire_at"
          ],
          sort: [{ field: "next_follow_up_at", direction: "asc" }],
          limit: 20,
          display: {
            domain: "sales",
            target: "customers",
            operation: "search",
            reason: "\u5148\u67e5\u8be2\u5f53\u524d\u7528\u6237\u53ef\u8bbf\u95ee\u7684\u5ba2\u6237\uff0c\u518d\u7ed3\u5408\u8ba2\u5355\u5224\u65ad\u4f18\u5148\u8ddf\u8fdb\u9879\u3002"
          }
        }
      },
      {
        name: "query_business_data",
        args: {
          resource: "orders",
          operation: "search",
          filters: [],
          metrics: [],
          fields: [
            "id",
            "customer_id",
            "customer_name",
            "status",
            "amount",
            "created_at",
            "expected_delivery"
          ],
          sort: [{ field: "created_at", direction: "desc" }],
          limit: 20,
          display: {
            domain: "sales",
            target: "orders",
            operation: "search",
            reason: "\u7ee7\u7eed\u67e5\u8be2\u6388\u6743\u5ba2\u6237\u7684\u6700\u8fd1\u8ba2\u5355\uff0c\u7528\u4e8e\u52a8\u6001\u89c2\u5bdf\u548c\u56de\u7b54\u3002"
          }
        }
      }
    ],
    reason: "\u8fd9\u662f\u5ba2\u6237\u7ecf\u8425\u7c7b\u7efc\u5408\u95ee\u9898\uff0c\u5148\u67e5\u53ef\u8bbf\u95ee\u5ba2\u6237\u548c\u6700\u8fd1\u8ba2\u5355\uff0c\u518d\u8fdb\u884c\u89c2\u5bdf\u4e0e\u5f52\u7eb3\u3002"
  };
}

function shouldRetrieveKnowledge({ question, route }) {
  if (String(route?.intent_code ?? "").startsWith("dealer.")) return false;
  if (route?.intent === INTENTS.KNOWLEDGE_QA) return true;
  if (route?.intent !== INTENTS.MIXED) return false;
  return /(制度|政策|流程|标准|手册|报销|试用期|年假|病假|权限|审批|规则|依据|资料|文档)/.test(String(question ?? ""));
}

function buildKnowledgeRetrievalPlan(question) {
  return {
    calls: [{
      name: "retrieve_knowledge",
      args: {
        query: question,
        topK: 5
      }
    }],
    reason: "用户问题需要资料依据，调用知识检索 skill 获取可引用片段。"
  };
}

function extractMathExpression(question) {
  const text = String(question ?? "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/，/g, ",")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/％/g, "%");
  const candidates = text.match(/[0-9+\-*/%^().,\s]+/g)
    ?.map((item) => item.trim())
    .filter((item) => /\d/.test(item) && /[-+*/%^]/.test(item)) ?? [];
  const candidate = candidates.sort((left, right) => right.length - left.length)[0];
  if (!candidate) return null;
  const safe = candidate.replace(/\^/g, "**");
  if (!/^[0-9+\-*/%().,\s*]+$/.test(safe)) return null;
  return safe;
}

function hasExplicitDataLookup(question) {
  return /(查|查询|看一下|看看|统计|多少|几个|列表|有哪些|都有谁|状态|报表|pipeline|成交额|销售额|上级|下级|下属|负责人)/.test(String(question ?? ""));
}

async function isOrgDataQuestion(question) {
  const ir = await parseBusinessQuery({ user: { department: "" }, question, history: [] });
  return ir?.domain === "organization";
}

function isLeaveIntent(question) {
  return LEAVE_KEYWORDS.some((word) => question.includes(word))
    || /(请|休|申请|办)(个|一下|一会儿|半天|一天|几天)?假/.test(question);
}

async function buildOrgQueries({ question, asksAggregate }) {
  const mentionedDepartment = await findMentionedDepartment(question);
  if (mentionedDepartment && isPeopleCountQuestion(question)) {
    const departmentIds = await getDepartmentTreeIds(mentionedDepartment.id);
    return [buildEmployeeQueryCall({
      filters: [{ field: "department", op: "in", value: departmentIds }],
      asksAggregate: true,
      limit: 100
    })];
  }

  if (mentionedDepartment && /(负责人|主管|经理|leader|谁负责)/i.test(question)) {
    return [{
      name: "query_business_data",
      args: {
        resource: "departments",
        operation: "search",
        filters: [{ field: "id", op: "eq", value: mentionedDepartment.id }],
        metrics: [],
        fields: ["id", "name", "parentid", "leader_userid", "vertical_relation", "vertical_department", "relation"],
        sort: [{ field: "order", direction: "asc" }],
        limit: 1
      }
    }];
  }

  if (mentionedDepartment && /(有哪些|都有谁|人员|员工|同学|名单|列表)/.test(question)) {
    const departmentIds = await getDepartmentTreeIds(mentionedDepartment.id);
    return [buildEmployeeQueryCall({
      filters: [{ field: "department", op: "in", value: departmentIds }],
      asksAggregate: false,
      limit: 100
    })];
  }

  if (["组织架构", "部门结构", "部门列表", "有哪些部门"].some((word) => question.includes(word))) {
    return [{
      name: "query_business_data",
      args: {
        resource: "departments",
        operation: asksAggregate ? "aggregate" : "search",
        filters: [],
        metrics: asksAggregate ? [{ type: "count", field: "id", as: "department_count" }] : [],
        fields: ["id", "name", "parentid", "leader_userid", "vertical_relation", "vertical_department", "relation"],
        sort: [{ field: "order", direction: "asc" }],
        limit: 100
      }
    }];
  }

  const employeeName = await extractEmployeeName(question);
  const asksSubordinates = ["下属", "下级", "下辖", "下面", "团队", "同学"].some((word) => question.includes(word));
  const asksLeader = ["上级", "汇报", "直属", "领导", "主管"].some((word) => question.includes(word));
  const calls = [];

  if (employeeName || asksLeader || (question.includes("我") && !asksSubordinates)) {
    const filters = [];
    if (employeeName) filters.push({ field: "name", op: "eq", value: employeeName });
    if (!employeeName) filters.push({ field: "userid", op: "eq", value: "__CURRENT_USER__" });
    calls.push(buildEmployeeQueryCall({ filters, asksAggregate, limit: 1 }));
  }

  if (!employeeName && asksSubordinates) {
    calls.push(buildEmployeeQueryCall({
      filters: [{ field: "direct_leader", op: "contains", value: "__CURRENT_USER__" }],
      asksAggregate,
      limit: 50
    }));
  }

  if (calls.length > 0) return calls;
  const hasOrgSignal = ["组织", "部门", "部", "岗位", "人员", "员工"].some((word) => question.includes(word));
  return hasOrgSignal ? [buildEmployeeQueryCall({ filters: [], asksAggregate, limit: 50 })] : [];
}

function buildEmployeeQueryCall({ filters, asksAggregate, limit }) {
  return {
    name: "query_business_data",
    args: {
      resource: "employees",
      operation: asksAggregate ? "aggregate" : "search",
      filters,
      metrics: asksAggregate ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
      fields: ["userid", "name", "department_name", "position", "role", "direct_leader", "reporting", "main_department", "department"],
      sort: [{ field: "main_department", direction: "asc" }, { field: "userid", direction: "asc" }],
      limit
    }
  };
}

async function findMentionedDepartment(question) {
  const departments = await loadJson("data/wecom-departments.json");
  const normalized = String(question ?? "");
  return departments
    .slice()
    .sort((left, right) => String(right.name).length - String(left.name).length)
    .find((department) => normalized.includes(department.name)
      || normalized.includes(String(department.name).replace(/部$/, ""))
      || String(department.name).includes(normalized));
}

async function getDepartmentTreeIds(rootId) {
  const departments = await loadJson("data/wecom-departments.json");
  const ids = new Set([Number(rootId)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const department of departments) {
      if (ids.has(Number(department.parentid)) && !ids.has(Number(department.id))) {
        ids.add(Number(department.id));
        changed = true;
      }
    }
  }
  return [...ids];
}

function isPeopleCountQuestion(question) {
  return /(多少人|几个人|几名|人数|员工数|人员数|多少个员工|有多少.*(人|员工|同学))/.test(String(question ?? ""));
}

function hasEmployeeSelfQuery(calls) {
  return calls.some((call) => call.name === "query_business_data"
    && call.args?.resource === "employees"
    && call.args?.filters?.some((filter) => filter.field === "userid" && filter.value === "__CURRENT_USER__"));
}

function hasSubordinateQuery(calls) {
  return calls.some((call) => call.name === "query_business_data"
    && call.args?.resource === "employees"
    && call.args?.filters?.some((filter) => filter.field === "direct_leader" && filter.value === "__CURRENT_USER__"));
}

function splitForStreaming(text) {
  return String(text ?? "").match(/.{1,8}/gs) ?? [];
}

function buildCustomerQuery({ question, customerName, asksAggregate }) {
  const filters = [];
  if (customerName) filters.push({ field: "name", op: "eq", value: customerName });
  if (question.includes("科技")) filters.push({ field: "industry_category", op: "eq", value: "科技" });
  if (question.includes("制造")) filters.push({ field: "industry_category", op: "eq", value: "制造" });
  if (question.includes("零售")) filters.push({ field: "industry_category", op: "eq", value: "零售" });
  if (question.includes("物流")) filters.push({ field: "industry_category", op: "eq", value: "物流" });
  if (question.includes("未签单")) filters.push({ field: "deal_status", op: "eq", value: "未签单" });
  if (question.includes("已签单")) filters.push({ field: "deal_status", op: "eq", value: "已签单" });
  if (question.includes("跟进")) filters.push({ field: "follow_status", op: "contains", value: "跟进" });
  if (question.includes("待续签")) filters.push({ field: "renewal_status", op: "eq", value: "待续签" });

  return {
    name: "query_business_data",
    args: {
      resource: "customers",
      operation: asksAggregate ? "aggregate" : "search",
      filters,
      metrics: asksAggregate ? [{ type: "count", field: "id", as: "customer_count" }] : [],
      fields: [
        "id",
        "name",
        "tier",
        "industry",
        "industry_category",
        "deal_status",
        "follow_status",
        "renewal_status",
        "annual_revenue",
        "next_follow_up_at",
        "contract_expire_at"
      ],
      sort: [{ field: "next_follow_up_at", direction: "asc" }],
      limit: 20
    }
  };
}

function buildOrderQuery({ customerName }) {
  return {
    name: "query_business_data",
    args: {
      resource: "orders",
      operation: "search",
      filters: [{ field: "customer_name", op: "eq", value: customerName }],
      fields: ["id", "customer_name", "status", "amount", "created_at", "expected_delivery"],
      sort: [{ field: "created_at", direction: "desc" }],
      limit: 1
    }
  };
}

function buildSalesReportQuery({ user, question }) {
  return {
    name: "query_business_data",
    args: {
      resource: "sales_reports",
      operation: "search",
      filters: [
        { field: "department", op: "eq", value: extractDepartment(question) ?? user.department },
        { field: "period", op: "eq", value: extractPeriod(question) ?? "2026Q2" }
      ],
      fields: ["department", "period", "revenue", "pipeline", "top_customers"],
      limit: 1
    }
  };
}

function formatBusinessDataResult(data) {
  if (data.operation === "aggregate") {
    const metrics = data.metrics ?? [];
    const count = metrics.find((item) => item.type === "count")?.value ?? data.total;
    if (data.resource === "employees") return `查询结果：符合条件的员工共 ${count} 人。`;
    if (data.resource === "departments") return `查询结果：符合条件的组织节点共 ${count} 个。`;
    if (data.resource === "leave_requests") {
      return isTeamLeaveRecordResult(data)
        ? `查询结果：符合条件的团队请假记录共 ${count} 条。`
        : `查询结果：你共有 ${count} 条请假记录。`;
    }
    return `查询结果：符合条件的${resourceName(data.resource)}共 ${count} 条。`;
  }

  const rows = data.rows ?? [];
  if (rows.length === 0) {
    return `没有找到符合条件的${resourceName(data.resource)}。`;
  }

  if (data.resource === "orders") {
    const order = rows[0];
    return `客户「${order.customer_name}」最近订单 ${order.id} 当前状态为「${order.status}」，金额 ${order.amount} 元。${order.expected_delivery ? `预计交付时间是 ${order.expected_delivery}。` : ""}`;
  }

  if (data.resource === "sales_reports") {
    const report = rows[0];
    return `${report.department} 在 ${report.period} 的销售收入为 ${report.revenue} 元，pipeline 为 ${report.pipeline} 元。`;
  }

  if (data.resource === "employees") {
    if (isCurrentUserLeaderLookup(data)) {
      const row = rows[0];
      const leader = Array.isArray(row.direct_leader_profiles) ? row.direct_leader_profiles[0] : null;
      const reportingText = formatReporting(row.reporting);
      return leader?.name
        ? `你的直属上级是 ${formatEmployeeProfile(leader)}。${reportingText}`
        : `${row.name} 当前没有配置直属上级。${reportingText}`;
    }
    const lines = [`查询到 ${rows.length} 名员工：`];
    for (const row of rows) {
      const leaderText = Array.isArray(row.direct_leader) && row.direct_leader.length
        ? formatEmployeeProfiles(row.direct_leader_profiles, row.direct_leader)
        : "无";
      const reportingText = formatReporting(row.reporting);
      lines.push(`- ${row.name}：${row.department_name} / ${row.position}。直属上级：${leaderText}。${reportingText}`);
    }
    return lines.join("\n");
  }

  if (data.resource === "departments") {
    if (rows.length === 1 && data.query?.display?.reason?.includes("负责人")) {
      const row = rows[0];
      const leader = row.leader_profile?.name ? formatEmployeeProfile(row.leader_profile) : "暂未配置";
      return `${row.name}的负责人是 ${leader}。`;
    }
    const lines = [`查询到 ${rows.length} 个组织节点：`];
    for (const row of rows) {
      const extras = [
        row.vertical_department ? `垂直归属：${row.vertical_department}` : null,
        row.relation ? `关系：${row.relation}` : null
      ].filter(Boolean).join("；");
      const leader = row.leader_profile?.name ? `${row.leader_profile.name}（${row.leader_profile.position ?? "负责人"}）` : "暂未配置";
      lines.push(`- ${row.name}：负责人 ${leader}${extras ? `，${extras}` : ""}。`);
    }
    return lines.join("\n");
  }

  if (data.resource === "leave_requests") {
    const lines = [isSelfLeaveRecordResult(data)
      ? `查询到 ${rows.length} 条你的请假记录：`
      : `查询到 ${rows.length} 条请假记录：`];
    for (const row of rows) {
      const applicantPrefix = isSelfLeaveRecordResult(data) ? "" : `${row.applicant_name}：`;
      lines.push(`- ${applicantPrefix}${row.leave_type}，${row.leave_duration}，${row.start_time} 至 ${row.end_time}，事由：${row.reason}，状态：${row.status}。`);
    }
    return lines.join("\n");
  }

  if (String(data.resource).startsWith("dealer_")) {
    return formatDealerRows(data.resource, rows);
  }

  const lines = [`查询到 ${rows.length} 条${resourceName(data.resource)}：`];
  for (const row of rows) {
    lines.push(`- ${row.name}（${row.id}）：${row.tier} 类，${row.industry}，签单状态「${row.deal_status}」，跟进状态「${row.follow_status}」，续签状态「${row.renewal_status}」，年度成交额 ${row.annual_revenue} 元。`);
  }
  return lines.join("\n");
}

function isCurrentUserLeaderLookup(data) {
  const filters = data.query?.filters ?? [];
  return data.resource === "employees"
    && data.rows?.length === 1
    && filters.some((filter) => filter.field === "userid" && filter.value === "__CURRENT_USER__");
}

function formatSafeComputeResult(data) {
  const value = data?.value;
  const rendered = typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value);
  const sandbox = data?.sandbox;
  const suffix = sandbox
    ? `\n\n已在用户独立安全沙箱 ${sandbox.dir} 中完成，超时限制 ${sandbox.timeout_ms}ms，未开放 shell、网络和文件系统 API。`
    : "";
  return `计算结果：${rendered}${suffix}`;
}

function formatDealerAnalysisAnswer({ question, route, toolResults }) {
  const metricRows = toolResults
    .filter((result) => result.tool === "query_business_data" && result.data?.resource === "dealer_metrics")
    .flatMap((result) => result.data?.rows ?? []);
  if (!metricRows.length || route?.intent_code !== INTENT_CODES.DEALER_ANALYSIS_QUERY) return null;

  const rowsByStore = groupBy(metricRows, (row) => row.store_name || "全部门店");
  const storeSummaries = Object.entries(rowsByStore).map(([storeName, rows]) => summarizeDealerStore(storeName, rows));
  const ranked = storeSummaries.slice().sort((left, right) => right.score - left.score);
  const detailResources = toolResults
    .filter((result) => result.tool === "query_business_data" && result.data?.resource !== "dealer_metrics")
    .map((result) => ({
      resource: result.data.resource,
      total: result.data.total,
      rows: result.data.rows ?? []
    }));

  const lines = [];
  if (/(对比|哪家|压力更大)/.test(question) && ranked.length >= 2) {
    const top = ranked[0];
    const second = ranked[1];
    lines.push("## 经营压力对比");
    lines.push("");
    lines.push(`**结论：${top.storeName} 当前经营压力略高于 ${second.storeName}。**`);
    lines.push("");
    lines.push(`判断依据：${top.storeName} 有 ${top.critical} 项严重风险、${top.warning} 项警示风险，风险分 ${top.score}；${second.storeName} 有 ${second.critical} 项严重风险、${second.warning} 项警示风险，风险分 ${second.score}。`);
  } else if (/(日报|周报|月度|报告|复盘|看板|晨会|经营计划|行动项|管理动作)/.test(question)) {
    lines.push(`## ${buildDealerReportTitle(question)}`);
    lines.push("");
    const top = ranked[0];
    if (top) lines.push(`**总体判断：当前最高优先级是 ${top.storeName} 的 ${formatTopRisk(top.topRisks[0])}。**`);
  } else {
    const top = ranked[0];
    lines.push("## 经营风险判断");
    lines.push("");
    lines.push(`**结论：当前最该关注 ${top.storeName} 的 ${formatTopRisk(top.topRisks[0])}。**`);
  }

  lines.push("");
  lines.push("### 关键风险");
  for (const summary of ranked) {
    lines.push("");
    lines.push(`**${summary.storeName}**`);
    lines.push("");
    lines.push(`- 风险概览：${summary.critical} 项严重、${summary.warning} 项警示，风险分 ${summary.score}。`);
    const topRisks = summary.topRisks.slice(0, 5);
    if (!topRisks.length) {
      lines.push("- 重点风险：暂无高风险项。");
    } else {
      for (const risk of topRisks) {
        lines.push(`- ${formatTopRisk(risk)}：${risk.summary}`);
      }
    }
  }

  const details = summarizeDealerDetails(detailResources);
  if (details.length) {
    lines.push("");
    lines.push("### 数据明细支撑");
    for (const item of details) lines.push(`- ${item}`);
  }

  if (/(原因|为什么|承压|复盘|报告|方案)/.test(question)) {
    lines.push("");
    lines.push("### 原因分析");
    for (const summary of ranked) {
      const causes = summarizeDealerCauses(summary);
      if (causes.length) {
        lines.push("");
        lines.push(`**${summary.storeName}**`);
        for (const cause of causes) lines.push(`- ${cause}`);
      }
    }
  }

  lines.push("");
  lines.push("### 关键动作");
  const actionGroups = buildDealerActionGroups(ranked);
  for (const group of actionGroups) {
    lines.push("");
    lines.push(`**${group.storeName}**`);
    const byOwner = groupActionsByOwner(group.actions);
    for (const [owner, actions] of Object.entries(byOwner)) {
      lines.push(`- ${owner}：${actions.map((item) => stripSentenceEnd(item.text)).join("；")}。`);
    }
  }

  if (/(负责人|行动项|晨会|经营计划|下周)/.test(question)) {
    lines.push("");
    lines.push("### 负责人拆解");
    lines.push("- 销售负责人：跟进 H/A 级未成交线索、战败复盘、待交付订单收款和交付节点。");
    lines.push("- 库存负责人：处理高库龄与合格证风险车辆，给出清库、调拨或促销方案。");
    lines.push("- 财务负责人：跟进折让金余额、未结清应付和待结算返利，评估采购现金流。");
    lines.push("- 售后负责人：关闭未结算/施工中工单，补齐三包索赔证据。");
  }

  return lines.join("\n");
}

function summarizeDealerStore(storeName, rows) {
  const critical = rows.filter((row) => row.severity === "critical").length;
  const warning = rows.filter((row) => row.severity === "warning").length;
  const score = rows.reduce((total, row) => total + (row.severity === "critical" ? 3 : row.severity === "warning" ? 1 : 0), 0);
  const topRisks = rows
    .filter((row) => row.severity === "critical" || row.severity === "warning")
    .sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity) || Number(right.value) - Number(left.value));
  return { storeName, rows, critical, warning, score, topRisks };
}

function severityWeight(value) {
  if (value === "critical") return 3;
  if (value === "warning") return 1;
  return 0;
}

function formatTopRisk(row) {
  if (!row) return "暂无高风险项";
  const category = dealerCategoryName(row.category);
  return `${category}「${dealerMetricName(row.metric)}」${row.value}${row.unit ?? ""}（${row.severity}）`;
}

function dealerCategoryName(value) {
  return {
    inventory: "库存",
    sales: "销售",
    lead: "线索",
    finance: "财务",
    after_sales: "售后",
    warranty: "三包"
  }[value] ?? value;
}

function dealerMetricName(value) {
  return {
    stock_risk_vehicle_count: "库龄风险车",
    mortgaged_certificate_vehicle_count: "合格证抵押车",
    pending_delivery_order_count: "待交付订单",
    unpaid_order_count: "未结清订单",
    hot_open_lead_count: "H/A级未成交线索",
    no_contact_lead_count: "未首联线索",
    lost_lead_count: "战败线索",
    discount_wallet_balance: "折让金余额",
    unsettled_payable_amount: "未结清应付",
    pending_rebate_amount: "待结算返利",
    open_repair_order_count: "未关闭工单",
    warranty_claim_loss_risk_amount: "三包索赔损失风险"
  }[value] ?? value;
}

function buildDealerReportTitle(question) {
  if (question.includes("晨会")) return "晨会材料";
  if (question.includes("月度")) return "月度经营分析报告";
  if (question.includes("周报")) return "经营周报";
  if (question.includes("日报")) return "经营日报";
  if (question.includes("看板")) return "门店经营健康度看板";
  if (question.includes("经营计划")) return "下周经营计划";
  return "经营复盘";
}

function summarizeDealerDetails(resources) {
  const lines = [];
  for (const item of resources) {
    if (item.resource === "dealer_vehicles") {
      const risky = item.rows.filter((row) => row.stock_warning_level && row.stock_warning_level !== "正常");
      if (risky.length) lines.push(`库存：${risky.map((row) => `${row.vin} ${row.stock_age_days}天/${row.stock_warning_level}`).join("，")}`);
    }
    if (item.resource === "dealer_leads") {
      const weak = item.rows.filter((row) => row.status === "待首次联系" || row.status === "战败" || (!row.converted_order_id && ["H", "A"].includes(row.intention_level)));
      if (weak.length) lines.push(`线索：${weak.map((row) => `${row.customer_name}/${row.owner_name}/${row.intention_level}/${row.status}`).join("，")}`);
    }
    if (item.resource === "dealer_sales_orders") {
      const risky = item.rows.filter((row) => row.payment_status !== "已结清" || row.delivery_status !== "已交付");
      if (risky.length) lines.push(`订单：${risky.map((row) => `${row.id}/${row.payment_status}/${row.delivery_status}`).join("，")}`);
    }
    if (item.resource === "dealer_finance") {
      if (item.rows.length) lines.push(`财务：${item.rows.map((row) => `${row.id}/${row.resource_type}/${row.amount}/${row.status}`).join("，")}`);
    }
    if (item.resource === "dealer_repair_orders") {
      const open = item.rows.filter((row) => !["已结算", "已关闭"].includes(row.status));
      if (open.length) lines.push(`售后：${open.map((row) => `${row.id}/${row.order_type}/${row.status}`).join("，")}`);
    }
    if (item.resource === "dealer_warranty_claims") {
      const risky = item.rows.filter((row) => row.claim_status === "已拒绝" || Number(row.difference_amount ?? 0) > 0 || row.evidence_status === "照片不足");
      if (risky.length) lines.push(`三包：${risky.map((row) => `${row.id}/${row.claim_status}/差异${row.difference_amount}`).join("，")}`);
    }
  }
  return lines;
}

function summarizeDealerCauses(summary) {
  const categories = new Set(summary.topRisks.map((risk) => risk.category));
  const causes = [];
  if (categories.has("inventory")) causes.push("库存侧存在高库龄或合格证约束，可能占用资金并影响交付确定性。");
  if (categories.has("sales")) causes.push("销售侧存在待交付或未结清订单，说明交付链路仍有收款、开票或整备阻塞。");
  if (categories.has("lead")) causes.push("线索侧存在未成交高意向线索或战败线索，说明转化效率和价格策略需要复盘。");
  if (categories.has("finance")) causes.push("财务侧折让金、应付或返利压力会影响采购节奏和现金流安全边界。");
  if (categories.has("after_sales")) causes.push("售后侧未关闭工单积压，可能影响客户满意度和后续结算效率。");
  if (categories.has("warranty")) causes.push("三包侧存在拒赔或差异金额，通常与证据完整度、厂家审核口径和旧件材料有关。");
  return causes;
}

function buildDealerActionGroups(summaries) {
  const rankedRisks = summaries
    .flatMap((summary) => summary.topRisks.map((risk) => ({ storeName: summary.storeName, risk })))
    .sort((left, right) => severityWeight(right.risk.severity) - severityWeight(left.risk.severity) || Number(right.risk.value) - Number(left.risk.value));

  const grouped = new Map();
  for (const { storeName, risk } of rankedRisks) {
    const actions = grouped.get(storeName) ?? new Map();
    const action = actionForDealerRisk(risk);
    if (action) {
      const key = `${action.owner}:${action.text}`;
      actions.set(key, action);
    }
    grouped.set(storeName, actions);
  }

  return summaries
    .filter((summary) => grouped.has(summary.storeName))
    .map((summary) => ({
      storeName: summary.storeName,
      actions: [...grouped.get(summary.storeName).values()]
    }));
}

function groupActionsByOwner(actions) {
  const groups = {};
  for (const action of actions) {
    groups[action.owner] ??= [];
    if (!groups[action.owner].some((item) => item.text === action.text)) {
      groups[action.owner].push(action);
    }
  }
  return groups;
}

function stripSentenceEnd(text) {
  return String(text ?? "").replace(/[。；;]+$/g, "");
}

function actionForDealerRisk(risk) {
  if (risk.category === "inventory") {
    return {
      owner: "库存负责人",
      text: `优先处理${dealerMetricName(risk.metric)}，结合清库、调拨、促销或解押动作。`
    };
  }
  if (risk.category === "sales") {
    return {
      owner: "销售负责人",
      text: "逐单推进待交付和未结清订单，明确收款、开票、整备、交付阻塞点。"
    };
  }
  if (risk.category === "lead") {
    return {
      owner: "销售负责人",
      text: "当天清理未首联/H-A级未成交线索，并复盘战败原因。"
    };
  }
  if (risk.category === "finance") {
    return {
      owner: "财务负责人",
      text: "跟进折让金、应付和返利，评估采购现金流安全边界。"
    };
  }
  if (risk.category === "after_sales") {
    return {
      owner: "售后负责人",
      text: "关闭未结算或施工中工单，避免超时影响满意度。"
    };
  }
  if (risk.category === "warranty") {
    return {
      owner: "售后负责人",
      text: "补齐三包证据并复盘被拒/差异原因。"
    };
  }
  return null;
}

function groupBy(items, keyFn) {
  const groups = {};
  for (const item of items) {
    const key = keyFn(item);
    groups[key] ??= [];
    groups[key].push(item);
  }
  return groups;
}

function resourceName(resource) {
  if (resource === "customers") return "客户";
  if (resource === "orders") return "订单";
  if (resource === "sales_reports") return "销售报表";
  if (resource === "employees") return "员工";
  if (resource === "departments") return "组织节点";
  if (resource === "leave_requests") return "请假记录";
  if (resource === "dealer_stores") return "经销商门店";
  if (resource === "dealer_vehicles") return "整车库存";
  if (resource === "dealer_inbounds") return "在途订单";
  if (resource === "dealer_quotas") return "配额记录";
  if (resource === "dealer_leads") return "销售线索";
  if (resource === "dealer_sales_orders") return "销售订单";
  if (resource === "dealer_finance") return "财务流水";
  if (resource === "dealer_repair_orders") return "售后工单";
  if (resource === "dealer_warranty_claims") return "三包索赔";
  if (resource === "dealer_metrics") return "经营指标";
  return "记录";
}

function formatDealerRows(resource, rows) {
  const lines = [`查询到 ${rows.length} 条${resourceName(resource)}：`];
  for (const row of rows) {
    if (resource === "dealer_metrics") {
      lines.push(`- ${row.store_name} / ${row.category} / ${row.metric}：${row.value}${row.unit ?? ""}，风险级别「${row.severity}」。${row.summary} 建议：${row.recommendation}`);
    } else if (resource === "dealer_vehicles") {
      lines.push(`- ${row.vin}：${row.store_name} / ${row.series} ${row.model}，状态「${row.status}」，库龄 ${row.stock_age_days} 天（${row.stock_warning_level}），综合成本 ${row.landing_cost} 元。`);
    } else if (resource === "dealer_inbounds") {
      lines.push(`- ${row.id}：${row.store_name} / ${row.series} ${row.model}，${row.order_type}，状态「${row.status}」，预计到店 ${row.expected_arrival_date}${row.customer_name ? `，绑定客户 ${row.customer_name}` : ""}。`);
    } else if (resource === "dealer_quotas") {
      lines.push(`- ${row.id}：${row.store_name} / ${row.month} / ${row.series} ${row.model}，总配额 ${row.quota_total}，已绑定 ${row.bound_inbound_count}，剩余可承诺 ${row.available_quota}。`);
    } else if (resource === "dealer_leads") {
      lines.push(`- ${row.id}：${row.customer_name}，来源 ${row.source}，顾问 ${row.owner_name}，意向 ${row.intention_level}，状态「${row.status}」，跟进 ${row.followup_count} 次，到店 ${row.visit_count} 次${row.lost_reason ? `，战败原因：${row.lost_reason}` : ""}。`);
    } else if (resource === "dealer_sales_orders") {
      lines.push(`- ${row.id}：${row.customer_name} / ${row.series} ${row.model}，顾问 ${row.owner_name}，订单「${row.order_status}」，收款「${row.payment_status}」，交付「${row.delivery_status}」，成交价 ${row.final_price} 元，毛利 ${row.gross_profit} 元。`);
    } else if (resource === "dealer_finance") {
      const financeType = row.resource_type === "discount_wallet" ? "折让金" : row.resource_type;
      lines.push(`- ${row.id}：${row.store_name}，${financeType} / ${row.direction} / ${row.category}，金额 ${row.amount} 元，状态「${row.status}」${row.balance_after !== null && row.balance_after !== undefined ? `，变动后余额 ${row.balance_after} 元` : ""}。`);
    } else if (resource === "dealer_repair_orders") {
      lines.push(`- ${row.id}：${row.customer_name} / ${row.series}，类型「${row.order_type}」，状态「${row.status}」，服务顾问 ${row.service_advisor_name}，应收 ${row.receivable_amount} 元${row.warranty_claim_id ? `，关联三包 ${row.warranty_claim_id}` : ""}。`);
    } else if (resource === "dealer_warranty_claims") {
      lines.push(`- ${row.id}：${row.customer_name} / ${row.series}，故障 ${row.fault_category}（${row.fault_code}），状态「${row.claim_status}」，申报 ${row.claimed_amount} 元，核准 ${row.approved_amount ?? "待定"} 元，证据：${row.evidence_status}。`);
    } else {
      lines.push(`- ${row.name ?? row.id}：${row.status ?? "无状态"}`);
    }
  }
  return lines.join("\n");
}

function formatReporting(reporting) {
  if (!reporting || typeof reporting !== "object") return "";
  if (reporting.line === "store") return reporting.manager_profile?.name ? `门店线汇报给 ${formatEmployeeProfile(reporting.manager_profile)}。` : "门店线最高负责人。";
  if (reporting.line === "strong_vertical") return `强垂直汇报：${reporting.vertical_department ?? "未配置"} / ${reporting.vertical_manager_title ?? "未配置"}；门店负责人：${formatEmployeeProfile(reporting.store_manager_profile) ?? "未配置"}。`;
  if (reporting.line === "weak_vertical") return `弱垂直协同：${reporting.vertical_department ?? "未配置"}；门店负责人：${formatEmployeeProfile(reporting.store_manager_profile) ?? "未配置"}。`;
  return `汇报线：${reporting.line}。`;
}

function formatEmployeeProfiles(profiles = [], fallbackUserIds = []) {
  const text = profiles
    .filter(Boolean)
    .map((profile) => formatEmployeeProfile(profile))
    .filter(Boolean);
  return text.length ? text.join("、") : "暂未配置";
}

function formatEmployeeProfile(profile) {
  if (!profile) return null;
  const title = [profile.department_name, profile.position].filter(Boolean).join(" / ");
  return title ? `${profile.name}（${title}）` : profile.name;
}

function isTeamLeaveRecordResult(data) {
  return Boolean(data?.query?.filters?.some((filter) => filter.field === "applicant_user_id"
    && filter.op === "in"
    && Array.isArray(filter.value)));
}

function isSelfLeaveRecordResult(data) {
  return Boolean(data?.query?.filters?.some((filter) => filter.field === "applicant_user_id"
    && filter.op === "eq"
    && filter.value === "__CURRENT_USER__"));
}

async function extractCustomerName(question, history = []) {
  const customers = await loadJson("data/customers.json");
  const direct = customers.find((customer) => question.includes(customer.name))?.name;
  if (direct) return direct;
  if (!/(它|他|她|这个|该客户|刚才|上面|这个客户)/.test(question)) return null;
  const historyText = history
    .slice()
    .reverse()
    .map((item) => item.text)
    .filter(Boolean)
    .join("\n");
  return customers.find((customer) => historyText.includes(customer.name))?.name ?? null;
}

async function extractEmployeeName(question) {
  const employees = await loadJson("data/wecom-users.json");
  return employees.find((employee) => question.includes(employee.name))?.name ?? null;
}

function extractDepartment(question) {
  const departments = ["华东销售部", "华南销售部", "人力资源部"];
  return departments.find((department) => question.includes(department)) ?? null;
}

function extractPeriod(question) {
  if (question.includes("今年") || question.includes("本年")) return "2026Q2";
  if (question.includes("Q2") || question.includes("二季度")) return "2026Q2";
  return null;
}

function composeCustomerOrderRiskAnswer({ question, toolResults, agentState }) {
  const wantsRiskAnalysis = /(分析|风险|诊断|复盘|优先级|建议|行动)/.test(question)
    || ["analysis", "report", "action_plan"].includes(agentState?.task_type);
  if (!wantsRiskAnalysis) return null;

  const customers = new Map();
  const orders = [];
  for (const result of toolResults) {
    if (result.tool === "list_my_customers") {
      for (const customer of result.data?.customers ?? []) {
        if (customer?.id || customer?.name) customers.set(customer.id ?? customer.name, customer);
      }
    }
    if (result.tool === "query_customer" && result.data) {
      customers.set(result.data.id ?? result.data.name, result.data);
    }
    if (result.tool === "query_order" && result.data) {
      orders.push(result.data);
    }
    if (result.tool === "query_business_data" && result.data?.resource === "customers") {
      for (const customer of result.data.rows ?? []) {
        if (customer?.id || customer?.name) customers.set(customer.id ?? customer.name, customer);
      }
    }
    if (result.tool === "query_business_data" && result.data?.resource === "orders") {
      orders.push(...(result.data.rows ?? []));
    }
  }

  if (!customers.size && !orders.length) return null;

  const riskLines = [];
  const actionLines = [];
  for (const order of orders) {
    const name = order.customer_name ?? order.customerName ?? "未知客户";
    const status = order.status ?? order.order_status ?? "未知状态";
    const amount = formatAmount(order.amount);
    if (/(合同|审批)/.test(status)) {
      riskLines.push(`${name} 的订单仍在「${status}」，金额${amount}，主要风险是合同或审批节点阻塞，影响签约确认和收入落地。`);
      actionLines.push(`推进 ${name} 的合同审批，明确卡点、负责人和预计完成时间。`);
    } else if (/(待发货|待交付|整备|发货)/.test(status)) {
      riskLines.push(`${name} 的订单处于「${status}」，金额${amount}，主要风险是交付节点延迟，可能影响客户体验和回款节奏。`);
      actionLines.push(`跟进 ${name} 的交付排期和发货准备，确认 ${order.expected_delivery ? `${order.expected_delivery} 前` : ""}是否能完成。`);
    } else {
      riskLines.push(`${name} 的订单状态为「${status}」，金额${amount}，需要继续跟踪状态变化。`);
    }
  }

  for (const customer of customers.values()) {
    if (customer.tier === "B" || /未签单|跟进中|待续签/.test(`${customer.sign_status ?? ""}${customer.follow_status ?? ""}${customer.renewal_status ?? ""}`)) {
      const name = customer.name ?? customer.id ?? "未知客户";
      const tags = [customer.tier ? `${customer.tier} 类` : null, customer.industry, customer.sign_status, customer.follow_status, customer.renewal_status]
        .filter(Boolean)
        .join(" / ");
      riskLines.push(`${name}（${tags}）仍需要经营推进，风险在于转化或续签不确定。`);
      actionLines.push(`为 ${name} 设定下一次跟进目标，优先确认决策人、预算、审批进度和续签意向。`);
    }
  }

  const dedupedRisks = uniqueLines(riskLines);
  const dedupedActions = uniqueLines(actionLines);
  if (!dedupedRisks.length) return null;

  return {
    answer: [
      `结论：你当前可访问 ${customers.size || "若干"} 个客户，已查到 ${orders.length} 条相关订单；主要风险集中在订单审批/交付推进和客户转化/续签不确定性。`,
      "",
      "关键风险：",
      ...dedupedRisks.map((line) => `- ${line}`),
      "",
      "建议动作：",
      ...dedupedActions.slice(0, 5).map((line) => `- ${line}`)
    ].join("\n")
  };
}

function formatAmount(value) {
  return value === undefined || value === null || value === "" ? "未提供" : `${value} 元`;
}

function uniqueLines(lines) {
  return Array.from(new Set(lines.filter(Boolean)));
}

function summarizeChunk(text, question) {
  const sentences = text
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (question.includes("标准")) {
    return `${sentences.slice(0, 3).join("。")}。`;
  }

  const important = sentences.find((sentence) => {
    return ["报销", "试用期", "年假", "审批", "权限", "订单", "客户", "敏感"].some(
      (word) => question.includes(word) && sentence.includes(word)
    );
  });
  return important ? `${important}。` : `${sentences.slice(0, 2).join("。")}。`;
}

function chooseAnswerChunk(docs, question) {
  const headingHints = [
    ["标准", ["标准", "住宿标准", "交通标准"]],
    ["时限", ["时限", "提交时限"]],
    ["审批", ["审批", "合同审批"]],
    ["试用期", ["试用期"]],
    ["年假", ["年假"]],
    ["权限", ["权限", "最小权限", "客户数据访问"]]
  ];

  for (const [keyword, headings] of headingHints) {
    if (!question.includes(keyword)) continue;
    const matched = docs.find((doc) => headings.some((heading) => doc.metadata.heading.includes(heading)));
    if (matched) return matched;
  }

  return docs[0];
}

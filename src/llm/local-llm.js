import { loadJson } from "../data/load-json.js";
import { inferIntentCode } from "../agent/intent-codes.js";
import { INTENT_CODES, INTENTS } from "../agent/ports.js";
import { compileBusinessQueryIR } from "../query/query-compiler.js";
import {
  isBusinessDataQuestion,
  isCustomerQuestion,
  isLeaveRecordQuestion,
  isOrderQuestion,
  isOrgQuestion,
  isSalesReportQuestion,
  parseBusinessQuery
} from "../query/query-parser.js";

const DATA_KEYWORDS = ["客户", "订单", "成交额", "销售额", "报表", "pipeline", "合同金额", "发货", "交付", "状态", "进展", "列表", "名下", "负责", "多少", "几个", "数量", "签单", "续签", "跟进", "行业", "组织", "组织架构", "部门", "上级", "下级", "下属", "下辖", "下面", "团队", "同学", "汇报", "直属", "领导", "主管", "岗位"];
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
    const hasData = DATA_KEYWORDS.some((word) => question.includes(word)) || await isBusinessDataQuestion(question);
    const hasKb = KB_KEYWORDS.some((word) => question.includes(word));
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

  async generateAnswer({ question, route, docs, toolResults }) {
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
    const lines = [`查询到 ${rows.length} 名员工：`];
    for (const row of rows) {
      const leaderText = Array.isArray(row.direct_leader) && row.direct_leader.length
        ? formatEmployeeProfiles(row.direct_leader_profiles, row.direct_leader)
        : "无";
      const reportingText = formatReporting(row.reporting);
      lines.push(`- ${row.name}（${row.userid}）：${row.department_name} / ${row.position}。直属上级：${leaderText}。${reportingText}`);
    }
    return lines.join("\n");
  }

  if (data.resource === "departments") {
    const lines = [`查询到 ${rows.length} 个组织节点：`];
    for (const row of rows) {
      const extras = [
        row.vertical_department ? `垂直归属：${row.vertical_department}` : null,
        row.relation ? `关系：${row.relation}` : null
      ].filter(Boolean).join("；");
      const leader = row.leader_profile?.name ? `${row.leader_profile.name}（${row.leader_profile.position ?? row.leader_userid}）` : row.leader_userid;
      lines.push(`- ${row.name}（ID ${row.id}）：上级部门ID ${row.parentid}，负责人 ${leader}${extras ? `，${extras}` : ""}。`);
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

  const lines = [`查询到 ${rows.length} 条${resourceName(data.resource)}：`];
  for (const row of rows) {
    lines.push(`- ${row.name}（${row.id}）：${row.tier} 类，${row.industry}，签单状态「${row.deal_status}」，跟进状态「${row.follow_status}」，续签状态「${row.renewal_status}」，年度成交额 ${row.annual_revenue} 元。`);
  }
  return lines.join("\n");
}

function resourceName(resource) {
  if (resource === "customers") return "客户";
  if (resource === "orders") return "订单";
  if (resource === "sales_reports") return "销售报表";
  if (resource === "employees") return "员工";
  if (resource === "departments") return "组织节点";
  if (resource === "leave_requests") return "请假记录";
  return "记录";
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
  return text.length ? text.join("、") : fallbackUserIds.join("、");
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

import { resolveEntities } from "./entity-resolver.js";
import { createQueryIR } from "./query-ir.js";

export async function parseBusinessQuery({ user, question, history = [], conversationContext }) {
  const entities = await resolveEntities(question, history);
  const operation = inferOperation(question);

  if (isContextContinuationForTarget(conversationContext, "leave_requests") || isLeaveRecordQuestion(question)) {
    return parseLeaveRecordQuery({ user, question, operation, entities });
  }

  if (isSalesReportQuestion(question) && !entities.customer) {
    return createQueryIR({
      domain: "sales",
      target: "sales_reports",
      operation: "search",
      filters: [
        { field: "department", op: "eq", value: extractSalesReportDepartment({ user, question }) },
        { field: "period", op: "eq", value: extractPeriod(question) ?? "2026Q2" }
      ],
      limit: 1,
      reason: "用户查询销售报表或 pipeline。"
    });
  }

  if (isOrderQuestion(question)) {
    if (!entities.customer) {
      return createQueryIR({
        domain: "sales",
        target: "orders",
        operation: "search",
        needsClarification: "你想查询哪个客户的订单状态？",
        reason: "订单状态查询缺少客户实体。"
      });
    }
    return createQueryIR({
      domain: "sales",
      target: "orders",
      operation: "search",
      entity: entities.customer,
      filters: [{ field: "customer_name", op: "eq", value: entities.customer.name }],
      limit: 1,
      reason: "用户查询客户订单状态。"
    });
  }

  if (entities.department || isOrgQuestion(question)) {
    return parseOrganizationQuery({ user, question, entities, operation });
  }

  if (isDealerQuestion(question)) {
    return parseDealerQuery({ question, operation });
  }

  if (isCustomerQuestion(question) || entities.customer || operation === "aggregate") {
    return parseCustomerQuery({ question, entities, operation });
  }

  return null;
}

export async function planDealerMultiQuery({ question, operation = inferOperation(question) } = {}) {
  const text = String(question ?? "");
  if (!isDealerQuestion(text)) return null;
  const targets = [];
  const warrantyClaimId = extractWarrantyClaimId(text);
  if (warrantyClaimId && /(谁|跟|负责|顾问|处理|进展)/.test(text)) {
    targets.push("dealer_warranty_claims", "dealer_repair_orders");
  }
  if (isDealerAnalysisQuestion(text)) targets.push("dealer_metrics");
  if (/(销售订单|待交付订单|订单|交付|收款状态|开票|成交价|毛利|按揭|全款)/.test(text)) targets.push("dealer_sales_orders");
  if (/(库存|库龄|整车|车辆|VIN|合格证|展车|试驾车)/i.test(text)) targets.push("dealer_vehicles");
  if (/(线索|意向|跟进|到店|战败|漏斗|获客|客户来源|转化)/.test(text)) targets.push("dealer_leads");
  if (/(配额|可承诺|承诺交期|订一台|订车)/.test(text)) targets.push("dealer_quotas", "dealer_inbounds");
  if (/(折让金|应付|应收|付款|返利|财务|余额|到账|抵扣)/.test(text)) targets.push("dealer_finance");
  if (/(售后|维修|保养|工单|接待|质检|结算|服务顾问)/.test(text)) targets.push("dealer_repair_orders");
  if (/(三包|质保|索赔|故障码|厂家审核|核准金额|损失风险)/.test(text)) targets.push("dealer_warranty_claims");

  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length <= 1) return null;
  return uniqueTargets.map((target) => parseDealerQuery({ question: text, operation, forcedTarget: target }));
}

export async function isBusinessDataQuestion(question) {
  const entities = await resolveEntities(question);
  return Boolean(entities.customer || entities.employee || entities.department)
    || isDealerQuestion(question)
    || isDealerAnalysisQuestion(question)
    || isLeaveRecordQuestion(question)
    || isSalesReportQuestion(question)
    || isOrderQuestion(question)
    || isCustomerQuestion(question)
    || isOrgQuestion(question)
    || inferOperation(question) === "aggregate";
}

function parseDealerQuery({ question, operation, forcedTarget }) {
  const target = forcedTarget ?? inferDealerTarget(question);
  operation = normalizeDealerOperation({ target, question, operation });
  const filters = [];
  const store = extractDealerStore(question);
  const series = extractVehicleSeries(question);
  const warrantyClaimId = extractWarrantyClaimId(question);
  const repairOrderId = extractRepairOrderId(question);
  if (store) filters.push({ field: "store_name", op: "contains", value: store });
  if (series && ["dealer_vehicles", "dealer_inbounds", "dealer_quotas", "dealer_leads", "dealer_sales_orders", "dealer_repair_orders", "dealer_warranty_claims"].includes(target)) {
    filters.push({ field: "series", op: "contains", value: series });
  }

  if (target === "dealer_vehicles") {
    if (question.includes("库龄") || question.includes("超龄") || question.includes("风险")) filters.push({ field: "stock_warning_level", op: "in", value: ["关注", "预警", "紧急"] });
    if (question.includes("在库")) filters.push({ field: "status", op: "eq", value: "在库" });
    if (question.includes("锁定")) filters.push({ field: "status", op: "eq", value: "锁定" });
    if (question.includes("展车")) filters.push({ field: "vehicle_tag", op: "eq", value: "展示车" });
    if (question.includes("试驾")) filters.push({ field: "vehicle_tag", op: "eq", value: "试驾车" });
  }
  if (target === "dealer_inbounds" && question.includes("客户定制")) filters.push({ field: "order_type", op: "eq", value: "客户定制" });
  if (target === "dealer_quotas" && question.includes("没有配额")) filters.push({ field: "available_quota", op: "eq", value: 0 });
  if (target === "dealer_leads") {
    if (question.includes("H级") || question.includes("H 级")) filters.push({ field: "intention_level", op: "eq", value: "H" });
    if (question.includes("战败")) filters.push({ field: "status", op: "eq", value: "战败" });
    if (question.includes("待联系") || question.includes("未联系")) filters.push({ field: "status", op: "eq", value: "待首次联系" });
    if (question.includes("到店")) filters.push({ field: "visit_count", op: "gte", value: 1 });
  }
  if (target === "dealer_sales_orders") {
    if (question.includes("待交付")) filters.push({ field: "order_status", op: "contains", value: "待交付" });
    if (question.includes("按揭")) filters.push({ field: "order_type", op: "eq", value: "按揭" });
    if (question.includes("全款")) filters.push({ field: "order_type", op: "eq", value: "全款" });
  }
  if (target === "dealer_finance") {
    if (question.includes("折让金")) filters.push({ field: "resource_type", op: "eq", value: "discount_wallet" });
    if (question.includes("应付")) filters.push({ field: "resource_type", op: "eq", value: "payable" });
    if (question.includes("返利")) filters.push({ field: "resource_type", op: "eq", value: "rebate" });
    if (question.includes("收款") || question.includes("到账")) filters.push({ field: "resource_type", op: "eq", value: "receipt" });
  }
  if (target === "dealer_repair_orders") {
    if (warrantyClaimId) filters.push({ field: "warranty_claim_id", op: "eq", value: warrantyClaimId });
    if (repairOrderId) filters.push({ field: "id", op: "eq", value: repairOrderId });
    if (question.includes("三包")) filters.push({ field: "order_type", op: "eq", value: "三包索赔" });
    if (question.includes("待结算")) filters.push({ field: "status", op: "eq", value: "待结算" });
  }
  if (target === "dealer_warranty_claims") {
    if (warrantyClaimId) filters.push({ field: "id", op: "eq", value: warrantyClaimId });
    if (repairOrderId) filters.push({ field: "repair_order_id", op: "eq", value: repairOrderId });
    if ((question.includes("拒绝") || question.includes("被拒")) && question.includes("审核")) {
      filters.push({ field: "claim_status", op: "in", value: ["厂家审核中", "已拒绝"] });
    } else if (question.includes("拒绝") || question.includes("被拒")) {
      filters.push({ field: "claim_status", op: "eq", value: "已拒绝" });
    } else if (question.includes("审核")) {
      filters.push({ field: "claim_status", op: "contains", value: "审核" });
    }
    if (question.includes("差异")) filters.push({ field: "difference_amount", op: "gte", value: 1 });
  }
  if (target === "dealer_metrics") {
    const categories = [];
    if (question.includes("库存")) categories.push("inventory");
    if (question.includes("线索")) categories.push("lead");
    if (question.includes("销售") || question.includes("订单") || question.includes("交付")) categories.push("sales");
    if (question.includes("财务") || question.includes("折让金") || question.includes("应付") || question.includes("返利")) categories.push("finance");
    if (question.includes("售后") || question.includes("维修")) categories.push("after_sales");
    if (question.includes("三包") || question.includes("索赔")) categories.push("warranty");
    if (categories.length === 1) filters.push({ field: "category", op: "eq", value: categories[0] });
    if (categories.length > 1) filters.push({ field: "category", op: "in", value: [...new Set(categories)] });
    if (question.includes("风险") || question.includes("关注") || question.includes("优先")) filters.push({ field: "severity", op: "in", value: ["critical", "warning"] });
  }

  return createQueryIR({
    domain: "dealer",
    target,
    operation,
    filters,
    metrics: operation === "aggregate" ? [{ type: "count", field: defaultDealerCountField(target), as: `${target}_count` }] : [],
    sort: defaultDealerSort(target),
    limit: 20,
    reason: "用户查询经销商管理系统业务数据。"
  });
}

function inferDealerTarget(question) {
  const text = String(question ?? "");
  if (extractWarrantyClaimId(text)) return "dealer_warranty_claims";
  if (extractRepairOrderId(text)) return "dealer_repair_orders";
  if (isDealerAnalysisQuestion(text)) return "dealer_metrics";
  if (/(三包|质保|索赔|故障码|厂家审核|核准金额)/.test(text)) return "dealer_warranty_claims";
  if (/(售后|维修|保养|工单|接待|质检|结算|服务顾问)/.test(text)) return "dealer_repair_orders";
  if (/(折让金|应付|应收|付款|返利|财务|余额|到账|抵扣)/.test(text)) return "dealer_finance";
  if (/(销售订单|待交付订单|锁车|合同|交付|收款状态|开票|成交价|毛利|按揭|全款)/.test(text)) return "dealer_sales_orders";
  if (/(线索|意向|跟进|到店|战败|漏斗|获客|客户来源|转化)/.test(text)) return "dealer_leads";
  if (/(配额|可承诺|承诺交期|订一台|订车)/.test(text)) return "dealer_quotas";
  if (/(在途|到店|客户定制|交期)/.test(text)) return "dealer_inbounds";
  if (/(门店|店面|库容)/.test(text) && !/(库存|车辆|整车)/.test(text)) return "dealer_stores";
  return "dealer_vehicles";
}

function normalizeDealerOperation({ target, question, operation }) {
  const text = String(question ?? "");
  if (target === "dealer_quotas" && /(多少配额|多少.*可承诺|剩余|还有多少)/.test(text)) return "search";
  if (target === "dealer_finance" && /(余额|流水|明细|最近)/.test(text)) return "search";
  return operation;
}

function extractDealerStore(question) {
  const stores = ["华东旗舰店", "华南标准店", "华北卫星店", "华东", "华南", "华北"];
  return stores.find((item) => String(question ?? "").includes(item)) ?? null;
}

function extractVehicleSeries(question) {
  const series = ["汉", "宋L", "海豹", "秦PLUS", "唐", "元PLUS", "腾势N7"];
  return series.find((item) => String(question ?? "").includes(item)) ?? null;
}

function defaultDealerCountField(target) {
  if (target === "dealer_vehicles") return "vin";
  return "id";
}

function defaultDealerSort(target) {
  if (target === "dealer_vehicles") return [{ field: "stock_age_days", direction: "desc" }];
  if (target === "dealer_quotas") return [{ field: "available_quota", direction: "asc" }];
  if (target === "dealer_inbounds") return [{ field: "expected_arrival_date", direction: "asc" }];
  if (target === "dealer_finance") return [{ field: "occurred_at", direction: "desc" }];
  if (target === "dealer_warranty_claims") return [{ field: "submitted_at", direction: "desc" }];
  return [];
}

export function isDealerQuestion(question) {
  return /(WC-\d{6}-\d{3}|RO-\d{6}-\d{3}|经销商|DMS|门店|华东旗舰店|华南标准店|华北卫星店|总经理|经营体系|经销商体系|晨会|经营计划|行动项|VIN|整车|车辆|库存|库龄|在途|配额|PDI|合格证|展车|试驾车|调拨|线索|意向|到店|战败|漏斗|销售订单|待交付订单|锁车|承诺交期|订一台|订车|折让金|应付|应收|返利|售后|维修|保养|工单|三包|质保|索赔|汉EV|宋L|海豹|秦PLUS|元PLUS|腾势N7)/i.test(String(question ?? ""));
}

function extractWarrantyClaimId(question) {
  return String(question ?? "").match(/\bWC-\d{6}-\d{3}\b/i)?.[0]?.toUpperCase() ?? null;
}

function extractRepairOrderId(question) {
  return String(question ?? "").match(/\bRO-\d{6}-\d{3}\b/i)?.[0]?.toUpperCase() ?? null;
}

export function isDealerAnalysisQuestion(question) {
  const text = String(question ?? "");
  if (isSimpleOwnerLookup(text)) return false;
  const hasAnalysisView = /(经营|分析|日报|周报|复盘|最该关注|优先级|看板|总览|汇总|建议|总经理|体系|晨会|行动项|经营计划|负责人|管理动作|协调问题)/.test(text);
  const hasRiskReview = /风险/.test(text) && /(经营|总览|复盘|分析|有哪些|哪里|最该关注|优先级)/.test(text);
  const hasManagementTask = /(晨会|行动项|经营计划|管理动作|协调问题|负责人|总经理视角|经销商体系)/.test(text);
  return (hasAnalysisView || hasRiskReview)
    && (hasManagementTask || /(经销商|门店|销售订单|库存|线索|售后|财务|三包|折让金|华东旗舰店|华南标准店|华北卫星店)/.test(text));
}

function isSimpleOwnerLookup(text) {
  return /(谁|哪位).{0,8}(负责人|主管|经理|总经理)|(?:负责人|主管|经理|总经理).{0,8}(是谁|哪位|谁)/.test(String(text ?? ""));
}

function parseOrganizationQuery({ user, question, entities, operation }) {
  if (isStoreLeaderQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation: "search",
      entity: { type: "department", id: 1, name: "门店管理层" },
      filters: [{ field: "id", op: "eq", value: 1 }],
      limit: 1,
      reason: "用户查询当前门店负责人。"
    });
  }

  if (entities.department && isDepartmentLeaderQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation: "search",
      entity: entities.department,
      filters: [{ field: "id", op: "eq", value: entities.department.id }],
      limit: 1,
      reason: "用户查询部门负责人。"
    });
  }

  const currentDepartmentId = user?.main_department ?? user?.department_id ?? user?.wecom?.main_department ?? user?.wecom?.department?.[0];
  if (isCurrentDepartmentLeaderQuestion(question) && currentDepartmentId) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation: "search",
      entity: { type: "department", id: currentDepartmentId, name: user.department },
      filters: [{ field: "id", op: "eq", value: currentDepartmentId }],
      limit: 1,
      reason: "用户查询当前所在部门负责人。"
    });
  }

  if (isFirstLevelDepartmentQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation: "search",
      filters: [{ field: "parentid", op: "eq", value: 1 }],
      limit: 100,
      reason: "用户查询门店一级部门。"
    });
  }

  if (entities.department && (isPeopleCountQuestion(question) || isDepartmentPeopleQuestion(question))) {
    return createQueryIR({
      domain: "organization",
      target: "employees",
      operation,
      entity: {
        ...entities.department,
        include_children: true
      },
      filters: [{ field: "department", op: "in_department_tree", value: entities.department.id }],
      metrics: operation === "aggregate" ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
      limit: 100,
      reason: "用户按部门查询员工或人数。"
    });
  }

  if (isDepartmentListQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation,
      metrics: operation === "aggregate" ? [{ type: "count", field: "id", as: "department_count" }] : [],
      limit: 100,
      reason: "用户查询组织架构或部门列表。"
    });
  }

  if (entities.employee || isLeaderQuestion(question) || (question.includes("我") && !isSubordinateQuestion(question))) {
    const filters = [];
    if (entities.employee) filters.push({ field: "name", op: "eq", value: entities.employee.name });
    if (!entities.employee) filters.push({ field: "userid", op: "eq", value: "__CURRENT_USER__" });
    return createQueryIR({
      domain: "organization",
      target: "employees",
      operation,
      entity: entities.employee,
      filters,
      metrics: operation === "aggregate" ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
      limit: 1,
      reason: "用户查询员工个人组织、岗位或上级信息。"
    });
  }

  if (isSubordinateQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "employees",
      operation,
      filters: [{ field: "direct_leader", op: "contains", value: "__CURRENT_USER__" }],
      metrics: operation === "aggregate" ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
      limit: 50,
      reason: "用户查询当前员工下属。"
    });
  }

  return createQueryIR({
    domain: "organization",
    target: "employees",
    operation,
    metrics: operation === "aggregate" ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
    limit: 50,
    reason: "用户查询组织人员数据。"
  });
}

function parseCustomerQuery({ question, entities, operation }) {
  const filters = [];
  if (entities.customer) filters.push({ field: "name", op: "eq", value: entities.customer.name });
  if (question.includes("科技")) filters.push({ field: "industry_category", op: "eq", value: "科技" });
  if (question.includes("制造")) filters.push({ field: "industry_category", op: "eq", value: "制造" });
  if (question.includes("零售")) filters.push({ field: "industry_category", op: "eq", value: "零售" });
  if (question.includes("物流")) filters.push({ field: "industry_category", op: "eq", value: "物流" });
  if (question.includes("未签单")) filters.push({ field: "deal_status", op: "eq", value: "未签单" });
  if (question.includes("已签单")) filters.push({ field: "deal_status", op: "eq", value: "已签单" });
  if (question.includes("跟进")) filters.push({ field: "follow_status", op: "contains", value: "跟进" });
  if (question.includes("待续签")) filters.push({ field: "renewal_status", op: "eq", value: "待续签" });

  return createQueryIR({
    domain: "sales",
    target: "customers",
    operation,
    entity: entities.customer,
    filters,
    metrics: operation === "aggregate" ? [{ type: "count", field: "id", as: "customer_count" }] : [],
    limit: 20,
    reason: "用户查询客户数据。"
  });
}

function parseLeaveRecordQuery({ user, question, operation, entities }) {
  const filters = [];
  const selfScope = /(我|我的|本人)/.test(String(question ?? ""));
  const teamScope = /(同学|下属|下级|下辖|团队|组员|成员|谁)/.test(String(question ?? "")) && !selfScope;
  const companyScope = /(全公司|整个公司|公司全员|所有员工|全部员工)/.test(String(question ?? "")) && !selfScope;

  if (entities?.employee && user?.permissions?.includes("org:read")) {
    filters.push({ field: "applicant_name", op: "contains", value: entities.employee.name });
  } else if (companyScope && user?.permissions?.includes("org:read")) {
    filters.push({ field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" });
  } else if (teamScope && user?.permissions?.includes("org:read")) {
    filters.push({ field: "applicant_user_id", op: "in", value: "__CURRENT_USER_REPORTS__" });
  } else {
    filters.push({ field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" });
  }
  if (question.includes("年假")) filters.push({ field: "leave_type", op: "eq", value: "年假" });
  if (question.includes("病假")) filters.push({ field: "leave_type", op: "eq", value: "病假" });
  if (question.includes("事假")) filters.push({ field: "leave_type", op: "eq", value: "事假" });
  if (question.includes("调休")) filters.push({ field: "leave_type", op: "eq", value: "调休" });
  const monthToken = extractMonthToken(question);
  if (monthToken) filters.push({ field: "start_time", op: "contains", value: monthToken });
  const recentStart = extractRecentStartDate(question);
  if (recentStart) {
    filters.push({ field: "start_time", op: "gte", value: recentStart });
    filters.push({ field: "start_time", op: "lte", value: formatDate(new Date()) });
  }

  return createQueryIR({
    domain: "attendance",
    target: "leave_requests",
    operation,
    filters,
    metrics: operation === "aggregate" ? [{ type: "count", field: "id", as: "leave_request_count" }] : [],
    sort: [{ field: "start_time", direction: "desc" }],
    limit: 20,
    reason: entities?.employee
      ? "用户查询指定员工的请假记录。"
      : companyScope ? "用户查询组织范围内的请假记录。"
        : teamScope ? "用户查询汇报链员工的请假记录。" : "用户查询本人请假记录。"
  });
}

function isContextContinuationForTarget(context, target) {
  return context?.continuation?.is_likely_continuation === true
    && context?.last_task?.target === target;
}

function extractRecentStartDate(question) {
  const text = String(question ?? "");
  const monthsMatch = text.match(/最近\s*([一二两三四五六七八九十\d]+)\s*个?月/);
  if (!monthsMatch) return null;
  const months = parseChineseNumber(monthsMatch[1]);
  if (!months) return null;
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return formatDate(date);
}

function parseChineseNumber(token) {
  const text = String(token ?? "");
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [left, right] = text.split("十");
    return (left ? map[left] ?? 0 : 1) * 10 + (right ? map[right] ?? 0 : 0);
  }
  return map[text] ?? null;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferOperation(question) {
  return /(多少|几个|几次|多少次|数量|总数|统计|有多少|多少人|几个人|几名|人数)/.test(question) ? "aggregate" : "search";
}

export function isSalesReportQuestion(question) {
  return ["成交额", "销售额", "报表", "pipeline", "业绩"].some((word) => question.includes(word));
}

export function isOrderQuestion(question) {
  return ["订单", "发货", "交付", "状态"].some((word) => question.includes(word));
}

export function isCustomerQuestion(question) {
  const text = String(question ?? "");
  return ["客户", "等级", "行业", "签单", "续签", "跟进", "名下"].some((word) => text.includes(word))
    || /(我|自己).{0,4}负责/.test(text);
}

export function isOrgQuestion(question) {
  return ["组织", "组织架构", "部门", "部有", "上级", "下级", "下属", "下辖", "下面", "团队", "同学", "汇报", "直属", "领导", "主管", "岗位", "员工", "人员", "多少人", "负责人", "我们店", "门店"].some((word) => question.includes(word));
}

export function isLeaveRecordQuestion(question) {
  const text = String(question ?? "");
  const hasLeave = /(请.*假|休假|年假|病假|事假|调休)/.test(text);
  const asksRecord = /(记录|历史|明细|列表|查询|查看|查一下|统计|几次|多少次|有哪些|都有谁)/.test(text);
  const asksPeople = /(同学|下属|下级|下辖|团队|组员|成员|谁)/.test(text);
  return hasLeave && (asksRecord || asksPeople);
}

function isDepartmentListQuestion(question) {
  return ["组织架构", "部门结构", "部门列表", "有哪些部门"].some((word) => question.includes(word));
}

function isDepartmentLeaderQuestion(question) {
  return /(负责人|主管|经理|leader|谁负责)/i.test(question);
}

function isStoreLeaderQuestion(question) {
  return /(我们店|门店|店里|店).{0,8}(负责人|主管|经理|总经理|谁负责|谁管)|(?:负责人|主管|经理|总经理).{0,8}(我们店|门店|店里|店)/i.test(String(question ?? ""));
}

function isCurrentDepartmentLeaderQuestion(question) {
  return /(我们|咱们|本|当前|我所在|我的).{0,4}部门.{0,8}(负责人|主管|经理|谁负责|谁管)|(?:负责人|主管|经理).{0,8}(我们|咱们|本|当前|我所在|我的).{0,4}部门/i.test(String(question ?? ""));
}

function isFirstLevelDepartmentQuestion(question) {
  return /(1级|一级|一层|第一层).{0,6}(部门|组织)|(?:部门|组织).{0,6}(1级|一级|一层|第一层)/i.test(String(question ?? ""));
}

function isDepartmentPeopleQuestion(question) {
  return /(有哪些|哪些人|都有谁|都谁|谁在|人员|员工|同学|名单|列表)/.test(question);
}

function isPeopleCountQuestion(question) {
  return /(多少人|几个人|几名|人数|员工数|人员数|多少个员工|有多少.*(人|员工|同学))/.test(question);
}

function isLeaderQuestion(question) {
  return ["上级", "汇报", "直属", "领导", "主管"].some((word) => question.includes(word));
}

function isSubordinateQuestion(question) {
  return ["下属", "下级", "下辖", "下面", "团队", "同学"].some((word) => question.includes(word));
}

function extractSalesReportDepartment({ user, question }) {
  const departments = ["华东销售部", "华南销售部", "人力资源部", "销售部"];
  return departments.find((department) => question.includes(department)) ?? user.department;
}

function extractPeriod(question) {
  if (question.includes("今年") || question.includes("本年")) return "2026Q2";
  if (question.includes("Q2") || question.includes("二季度")) return "2026Q2";
  return null;
}

function extractMonthToken(question) {
  const explicit = String(question ?? "").match(/(\d{4}-\d{2})/);
  if (explicit) return explicit[1];
  const month = String(question ?? "").match(/(\d{1,2})月/);
  if (!month) return null;
  return `2026-${String(month[1]).padStart(2, "0")}`;
}

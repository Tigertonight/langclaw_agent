/**
 * Dealer 业务域 DomainPack。
 *
 * 聚合 dealer 域的所有声明式配置：资源、命令、确定性规则、extractors、
 * filter transforms、权限规则、字段标签、查询适配器、cron 模板、
 * intent code 映射、fact key 映射、工具标签、路由提示词等。
 */

import type { DomainPack, AgenticFallbackDefinition, ReportComposerDefinition, EvidenceInferenceDefinition, SkillMappingDefinition, IntentCodeInferenceFn, UserFieldSourceDefinition } from "../types.js";
import { registerComponentMapping } from "../../a2ui/openui-bridge.js";
import { DEALER_RESOURCES, DEALER_FIELD_LABELS } from "./resources.js";
import { DEALER_COMMANDS } from "./commands.js";
import { DEALER_DETERMINISTIC_RULES, DEALER_EXTRACTORS } from "./deterministic-rules.js";
import { DEALER_FILTER_TRANSFORMS } from "./filter-transforms.js";
import { DEALER_PERMISSION_RULES } from "./permission-rules.js";
import { DEALER_TOOL_PERMISSION_POLICIES } from "./tool-permission-policies.js";
import { dealerQueryAdapter } from "./query-adapter.js";
import { composeDealerReport } from "./dealer-report-composer.js";
import { inferDealerEvidenceFacts } from "./dealer-evidence.js";
import { vehicleProgressPlugin } from "./surfaces/vehicle-progress.js";
import { createDealerTools } from "./tools.js";

export const dealerPack: DomainPack = {
  id: "dealer",
  name: "经销商业务域",
  version: "1.0.0",
  conflictPolicy: "error",
  description: "销售订单、库存、线索、财务、三包索赔、维修工单、经营指标等经销商核心业务。",

  resources: DEALER_RESOURCES,
  tools: createDealerTools(),
  commands: DEALER_COMMANDS,
  deterministicRules: DEALER_DETERMINISTIC_RULES,
  extractors: DEALER_EXTRACTORS,
  filterTransforms: DEALER_FILTER_TRANSFORMS,
  permissionRules: DEALER_PERMISSION_RULES,
  toolPermissionPolicies: DEALER_TOOL_PERMISSION_POLICIES,
  fieldLabels: DEALER_FIELD_LABELS,
  queryAdapters: [dealerQueryAdapter],
  intentDir: "data/domains/dealer/intent-codes",

  // ── intent code 映射（resource → intent_code） ──
  intentCodeMappings: {
    dealer_stores: "dealer.store_query",
    dealer_vehicles: "dealer.inventory_query",
    dealer_inbounds: "dealer.inventory_query",
    dealer_quotas: "dealer.inventory_query",
    dealer_leads: "dealer.lead_query",
    dealer_sales_orders: "dealer.order_query",
    dealer_finance: "dealer.finance_query",
    dealer_repair_orders: "dealer.aftersales_query",
    dealer_warranty_claims: "dealer.warranty_query",
    dealer_metrics: "dealer.analysis_query",
  },

  // ── fact key 映射（resource → AgentState fact key） ──
  factKeyMappings: {
    dealer_metrics: "dealer_metrics",
    dealer_vehicles: "dealer_inventory_detail",
    dealer_leads: "dealer_lead_detail",
    dealer_sales_orders: "dealer_order_detail",
    dealer_finance: "dealer_finance_detail",
    dealer_repair_orders: "dealer_after_sales_detail",
    dealer_warranty_claims: "dealer_warranty_detail",
  },

  // ── 工具标签 ──
  toolLabels: {
    "dealer.query_sales_orders": "销售订单查询",
    "dealer.query_leads": "线索查询",
    "dealer.query_vehicles": "库存查询",
    "dealer.query_finance": "财务查询",
    "dealer.query_repair_orders": "售后工单查询",
  },

  // ── cron 模板 ──
  cronTemplates: [
    {
      id: "daily_sales_report",
      name: "每日销售日报",
      description: "每天 09:00 自动汇总前一日的销售订单、成交台量、毛利、线索转化率，生成结构化日报存入 task store，供晨会参考。",
      cron_expr: "0 9 * * *",
      task: "生成昨日经营日报：汇总昨日销售订单数量、成交金额、毛利、线索量、线索转化率，识别异常（日环比 ±15% 以上），以结构化方式输出结论（结论 + 关键指标 + 异常条目 + 数据时间戳）。",
      domain: "dealer_sales",
      allowed_tools: ["dealer.query_sales_orders", "dealer.query_leads", "dealer.query_vehicles", "task.create", "task.complete", "task.link_evidence"],
      max_steps: 8,
      tags: ["daily", "report", "sales"],
    },
    {
      id: "inventory_risk_check",
      name: "库存风险巡检",
      description: "每天 10:00 扫描库龄超过 90 天的车辆，识别滞销风险，输出车型/库龄/建议处置方式的列表。",
      cron_expr: "0 10 * * *",
      task: "扫描当前在库车辆，识别库龄超过 90 天的滞销车型，按库龄倒序排列，每条给出建议处置方式（降价促销 / 调拨 / 退厂），输出不超过 20 条的风险清单，写入 task store。",
      domain: "dealer_inventory",
      allowed_tools: ["dealer.query_vehicles", "dealer.query_sales_orders", "task.create", "task.complete", "task.link_evidence"],
      max_steps: 6,
      tags: ["daily", "inventory", "risk"],
    },
    {
      id: "overdue_workorder_alert",
      name: "超期工单提醒",
      description: "每天 11:00 检查维修工单，找出超承诺工期的在修工单，发送提醒摘要，帮助售后主管及时跟进。",
      cron_expr: "0 11 * * *",
      task: "查询所有状态为「在修」的维修工单，计算每单实际在厂天数，找出超过承诺工期的工单，按超期天数降序排列，生成超期工单提醒报告（工单号 / 车牌 / 超期天数 / 当前状态 / 建议行动），写入 task store。",
      domain: "dealer_aftersales",
      allowed_tools: ["dealer.query_repair_orders", "dealer.query_vehicles", "task.create", "task.complete", "task.link_evidence"],
      max_steps: 6,
      tags: ["daily", "aftersales", "workorder"],
    },
    {
      id: "lead_clearance_weekly",
      name: "线索清零周检",
      description: "每周一 09:30 检查本周新增线索的跟进状态，识别超过 48 小时未跟进的线索，发出清零提醒，防止线索流失。",
      cron_expr: "30 9 * * 1",
      task: "查询本周所有新增线索，找出创建超过 48 小时仍未完成首次跟进（状态为「未跟进」）的线索，按创建时间升序排列，生成线索清零提醒报告（线索编号 / 客户姓名 / 意向车型 / 创建时间 / 逾期小时数 / 负责人），写入 task store 并标记为紧急。",
      domain: "dealer_sales",
      allowed_tools: ["dealer.query_leads", "dealer.query_customers", "task.create", "task.complete", "task.link_evidence"],
      max_steps: 7,
      tags: ["weekly", "sales", "leads", "urgent"],
    },
    {
      id: "finance_anomaly_daily",
      name: "每日财务异常摘要",
      description: "每天 17:30 检查当日财务流水，识别金额异常（单笔超过均值 3 倍）、科目异常、缺单情况，生成 EOD 财务异常摘要。",
      cron_expr: "30 17 * * *",
      task: "查询当日财务数据，识别异常条目：单笔金额超过近 7 日日均 3 倍的、科目归属异常的、应收/应付缺少配对凭证的。输出 EOD 财务异常摘要（异常类型 / 金额 / 科目 / 时间戳 / 建议处置），无异常时输出【本日财务流水正常】，写入 task store。",
      domain: "dealer_finance",
      allowed_tools: ["dealer.query_finance", "dealer.query_sales_orders", "task.create", "task.complete", "task.link_evidence"],
      max_steps: 8,
      tags: ["daily", "finance", "anomaly"],
    },
  ],

  // ── Router 抽参示例片段 ──
  paramExtractionExamples: [
    "比如「汉EV」就是「汉EV」，不要简化为「汉」。",
  ],

  // ── 路由提示词片段 ──
  routerPromptHints: [
    "当用户提到经销商、门店、库存、车辆、库龄、在途、配额、PDI、合格证、线索、意向、到店、战败、锁车、折让金、应付、返利、售后、维修、工单、三包、索赔等关键词时，应路由到 dealer 域的对应 intent_code。",
    "dealer.analysis_query 适用于需要多资源交叉分析的经营复盘、报告、看板、晨会材料等场景。",
    "如果问题明显是在查经销商库存、线索、订单、财务、售后、三包或经营分析，请把 query_ir 写完整。",
    "经营分析、经营风险、日报、周报、复盘、优先级、最该关注什么这类问题，优先规划 target=dealer_metrics；如果用户同时点名库存/线索/订单/财务/售后/三包，可再由本地多资源规划补充明细资源。",
  ],

  // ── data_query 描述关键词 ──
  dataQueryKeywords: [
    "客户", "订单", "销售额", "报表", "跟进", "续签", "签单",
    "经销商库存", "线索", "销售订单", "折让金", "售后工单",
    "三包索赔", "经营分析", "经营风险", "经营日报", "经营周报",
  ],

  // ── 本地分类关键词 ──
  classificationKeywords: {
    data_query: [
      "VIN", "整车", "车辆", "库存", "在库", "库龄", "在途", "配额", "PDI", "合格证",
      "线索", "意向", "跟进", "到店", "战败", "漏斗", "转化率",
      "销售订单", "锁车", "合同", "交付", "收款", "开票", "成交价", "毛利",
      "折让金", "应付", "应收", "返利", "财务", "余额",
      "售后", "维修", "保养", "工单", "三包", "质保", "索赔",
      "经营分析", "经营风险", "日报", "周报", "复盘",
    ],
  },

  // ── 能力描述 ──
  capabilityDescriptions: [
    "查询经销商库存、线索、订单、财务、售后工单、三包索赔等业务数据",
    "生成经营分析报告和风险预警",
  ],

  // ── 独立任务关键词 ──
  standaloneTaskKeywords: [
    "客户", "订单", "库存", "线索", "门店", "经销商",
    "销售", "售后", "工单", "三包", "索赔", "财务",
  ],

  // ── A2UI Surface 插件 ──
  surfacePlugins: [vehicleProgressPlugin],

  // ── 短修正识别模式（门店名、车型名） ──
  shortCorrectionPatterns: [
    /^(那)?(华东|华南|华东旗舰店|华南标准店)(呢)?[？?]?$/,
    /^(那)?(海豹|汉EV|宋L|唐DM-p|唐DM|汉|唐|宋)(呢)?[？?]?$/,
  ],

  // ── metric 关键词映射 ──
  metricKeywordMappings: [
    [/毛利率|毛利/, "gross_margin"],
    [/成交总额|销售额|总额/, "total_revenue"],
    [/订单数|多少单|卖了多少|数量/, "order_count"],
    [/平均成交价/, "avg_price"],
    [/最高/, "max_price"],
    [/线索数/, "lead_count"],
    [/转化率/, "conversion_rate"],
    [/战败数|流失数/, "lost_count"],
    [/未结清|待结算|没到账|未到账/, "unsettled_amount"],
    [/总金额|合计|多少钱/, "total_amount"],
    [/平均工时费|平均/, "avg_labor"],
    [/应收合计|结算金额|工单金额/, "total_receivable"],
  ],

  // ── LLM 答案生成提示词片段 ──
  answerPromptHints: [
    "如果工具结果包含 dealer_metrics，并且用户要求经营分析、报告、晨会、复盘、计划、看板或优先级，不要逐条堆 rows；应输出：结论、关键风险、数据依据、建议动作、负责人/行动项。",
    "经销商经营类回答必须只使用 dealer_* 工具结果；不要混入差旅、报销、请假、人事制度等知识库内容。",
    "回答经销商相关问题时，优先使用门店名称而非门店ID，金额使用万元为单位并保留两位小数。",
    "库存相关回答应包含库龄天数和预警等级，线索相关回答应包含意向等级和跟进次数。",
  ],

  // ── catalog domains ──
  catalogDomains: [
    { id: "dealer.analytics", label: "经营分析", description: "经销商经营指标分析", ownerDomain: "dealer" },
    { id: "dealer.risk", label: "风险监控", description: "库存、线索、财务风险监控", ownerDomain: "dealer" },
    { id: "dealer.crm", label: "客户线索", description: "线索管理和客户跟进", ownerDomain: "dealer" },
    { id: "dealer.inventory", label: "库存订单", description: "整车库存和在途订单管理", ownerDomain: "dealer" },
    { id: "dealer.aftersales", label: "售后工单", description: "维修工单和三包索赔", ownerDomain: "dealer" },
    { id: "dealer.finance", label: "财务与毛利", description: "财务流水和毛利分析", ownerDomain: "dealer" },
  ],

  // ── 查询 schema ──
  querySchemas: {
    dealer_stores: {
      entity: "dealer_store",
      fields: ["id", "name", "short_name", "city", "region", "store_type", "manager_user_id", "capacity", "status"],
      defaultFields: ["id", "name", "city", "region", "store_type", "capacity", "status"],
      defaultSort: [{ field: "id", direction: "asc" }],
    },
    dealer_vehicles: {
      entity: "dealer_vehicle",
      fields: ["vin", "store_id", "store_name", "series", "model", "year", "color", "source_type", "purchase_mode", "cost", "finance_interest_accrued", "landing_cost", "min_sale_price", "inbound_date", "stock_age_days", "stock_warning_level", "status", "certificate_status", "vehicle_tag", "mileage", "sales_order_id"],
      defaultFields: ["vin", "store_name", "series", "model", "color", "status", "stock_age_days", "stock_warning_level", "landing_cost", "certificate_status", "sales_order_id"],
      defaultSort: [{ field: "stock_age_days", direction: "desc" }],
    },
    dealer_inbounds: {
      entity: "dealer_inbound",
      fields: ["id", "store_id", "store_name", "order_type", "series", "model", "color", "customer_name", "sales_consultant_id", "byd_order_no", "status", "expected_arrival_date", "customer_promised_date", "deposit_amount"],
      defaultFields: ["id", "store_name", "order_type", "series", "model", "color", "customer_name", "status", "expected_arrival_date", "customer_promised_date"],
      defaultSort: [{ field: "expected_arrival_date", direction: "asc" }],
    },
    dealer_quotas: {
      entity: "dealer_quota",
      fields: ["id", "store_id", "store_name", "month", "series", "model", "color", "quota_total", "bound_inbound_count", "available_quota"],
      defaultFields: ["id", "store_name", "month", "series", "model", "color", "quota_total", "bound_inbound_count", "available_quota"],
      defaultSort: [{ field: "available_quota", direction: "asc" }],
    },
    dealer_leads: {
      entity: "dealer_lead",
      fields: ["id", "customer_name", "phone_masked", "source", "campaign", "store_id", "store_name", "owner_user_id", "owner_name", "interested_series", "intention_level", "status", "created_at", "assigned_at", "first_contact_at", "last_followup_at", "followup_count", "visit_count", "expected_purchase_date", "lost_reason", "converted_order_id"],
      defaultFields: ["id", "customer_name", "source", "store_name", "owner_name", "interested_series", "intention_level", "status", "followup_count", "visit_count", "last_followup_at", "lost_reason", "converted_order_id"],
      defaultSort: [{ field: "created_at", direction: "desc" }],
    },
    dealer_sales_orders: {
      entity: "dealer_sales_order",
      fields: ["id", "store_id", "store_name", "customer_name", "owner_user_id", "owner_name", "vin", "series", "model", "order_type", "order_status", "payment_status", "invoice_status", "delivery_status", "list_price", "final_price", "landing_cost", "gross_profit", "deposit_amount", "paid_amount", "finance_amount", "created_at", "expected_delivery_date"],
      defaultFields: ["id", "store_name", "customer_name", "owner_name", "vin", "series", "model", "order_type", "order_status", "payment_status", "delivery_status", "final_price", "gross_profit", "expected_delivery_date"],
      defaultSort: [{ field: "created_at", direction: "desc" }],
    },
    dealer_finance: {
      entity: "dealer_finance_record",
      fields: ["id", "resource_type", "store_id", "store_name", "direction", "category", "amount", "balance_after", "related_order_id", "occurred_at", "status"],
      defaultFields: ["id", "resource_type", "store_name", "direction", "category", "amount", "balance_after", "related_order_id", "occurred_at", "status"],
      defaultSort: [{ field: "occurred_at", direction: "desc" }],
    },
    dealer_repair_orders: {
      entity: "dealer_repair_order",
      fields: ["id", "store_id", "store_name", "customer_name", "vin", "series", "service_advisor_id", "service_advisor_name", "order_type", "status", "appointment_at", "reception_at", "promised_finish_at", "labor_amount", "part_amount", "receivable_amount", "warranty_claim_id", "next_service_suggestion"],
      defaultFields: ["id", "store_name", "customer_name", "vin", "series", "service_advisor_name", "order_type", "status", "promised_finish_at", "receivable_amount", "warranty_claim_id"],
      defaultSort: [{ field: "appointment_at", direction: "desc" }],
    },
    dealer_warranty_claims: {
      entity: "dealer_warranty_claim",
      fields: ["id", "repair_order_id", "store_id", "store_name", "customer_name", "vin", "series", "fault_category", "fault_code", "claim_status", "claimed_amount", "approved_amount", "difference_amount", "submitted_at", "expected_settlement_at", "evidence_status"],
      defaultFields: ["id", "repair_order_id", "store_name", "customer_name", "vin", "series", "fault_category", "fault_code", "claim_status", "claimed_amount", "approved_amount", "difference_amount", "expected_settlement_at", "evidence_status"],
      defaultSort: [{ field: "submitted_at", direction: "desc" }],
    },
    dealer_metrics: {
      entity: "dealer_metric",
      fields: ["id", "scope", "store_name", "category", "metric", "value", "unit", "severity", "summary", "recommendation", "related_resource", "related_ids"],
      defaultFields: ["id", "store_name", "category", "metric", "value", "unit", "severity", "summary", "recommendation", "related_resource", "related_ids"],
      defaultSort: [{ field: "severity", direction: "asc" }, { field: "category", direction: "asc" }],
    },
  },

  // ── agentic fallbacks ──
  agenticFallbacks: [
    {
      id: "dealer_repair_week_over_week",
      matches(message: string): boolean {
        return /(维修工单|工单|售后).*(上周|对比|相比|环比|跟上周比|和上周比)/.test(message);
      },
      calls(_message: string) {
        return [
          { tool_name: "intent.dealer.aggregate.repair_orders", args: { metric: "total_receivable", time_range: "本周" } },
          { tool_name: "intent.dealer.aggregate.repair_orders", args: { metric: "total_receivable", time_range: "上周" } },
        ];
      },
      composeAnswer(observations) {
        const current = observations[0]?.answer ?? "本周暂无数据";
        const previous = observations[1]?.answer ?? "上周暂无数据";
        return `我分别查了本周和上周的售后维修工单结算金额。\n\n本周：${current}\n\n上周：${previous}\n\n当前离线环境无法调用规划模型做进一步归因，但两段口径已经按同一维修工单聚合指标返回，可用于人工对比。`;
      },
    } satisfies AgenticFallbackDefinition,
  ],

  // ── report composers ──
  reportComposers: [
    {
      id: "dealer_analysis_report",
      matches(input) {
        return composeDealerReport(input) !== null;
      },
      compose(input) {
        return composeDealerReport(input);
      },
    } satisfies ReportComposerDefinition,
  ],

  // ── evidence inference ──
  evidenceInferenceFns: [
    {
      id: "dealer_evidence",
      inferFacts(message, route) {
        return inferDealerEvidenceFacts(message, route);
      },
    } satisfies EvidenceInferenceDefinition,
  ],

  // ── skill mappings ──
  skillMappings: [
    {
      matches: (intentCode) => intentCode.startsWith("dealer.") || intentCode === "business.query",
      skillId: "business-query",
    } satisfies SkillMappingDefinition,
  ],

  // ── intent code 推断函数 ──
  intentCodeInferenceFns: [
    // WC-/RO- 编号模式
    ((message: string) => {
      if (/\bWC-\d{6}-\d{3}\b/i.test(message)) return "dealer.warranty_query";
      if (/\bRO-\d{6}-\d{3}\b/i.test(message)) return "dealer.after_sales_query";
      return null;
    }) satisfies IntentCodeInferenceFn,
    // 经营分析类
    ((message: string) => {
      return isDealerAnalysisMessage(message) ? "dealer.analysis_query" : null;
    }) satisfies IntentCodeInferenceFn,
    // 关键词匹配
    ((message: string) => {
      if (/(VIN|整车|车辆|库存|在库|库龄|在途|配额|PDI|合格证|展车|试驾车|调拨|承诺交期|订一台|订车|汉EV|宋L|海豹|秦PLUS|元PLUS|腾势N7)/i.test(message)) return "dealer.inventory_query";
      if (/(线索|意向|跟进|到店|战败|漏斗|转化率|获客|客户来源)/.test(message)) return "dealer.lead_query";
      if (/(销售订单|锁车|合同|交付|收款状态|开票|成交价|毛利|按揭|全款)/.test(message)) return "dealer.order_query";
      if (/(折让金|应付|应收|付款|返利|财务|余额|到账|抵扣|单车毛利)/.test(message)) return "dealer.finance_query";
      if (/(售后|维修|保养|工单|接待|质检|结算|服务顾问)/.test(message)) return "dealer.after_sales_query";
      if (/(三包|质保|索赔|厂家审核|核准金额|故障码|旧件)/.test(message)) return "dealer.warranty_query";
      return null;
    }) satisfies IntentCodeInferenceFn,
  ],

  // ── 短修正 delta 规则 ──
  correctionDeltaRules: [
    // ── 基础 extractor→field 映射（从 buildShortCorrectionDelta 硬编码迁入） ──
    {
      id: "dealer_store",
      extractor: "store",
      targetFields: ["store"],
    },
    {
      id: "dealer_time_range",
      extractor: "time_range",
      targetFields: ["time_range"],
    },
    {
      id: "dealer_price_min",
      extractor: "price_min",
      targetFields: ["price_min", "amount_min", "difference_min"],
      disambiguate: [
        { pattern: "应付|应收|款|金额", field: "amount_min" },
      ],
    },
    {
      id: "dealer_amount_min",
      extractor: "amount_min",
      targetFields: ["amount_min", "difference_min", "price_min"],
    },
    {
      id: "dealer_group_by",
      extractor: "group_by",
      targetFields: ["group_by"],
    },
    {
      id: "dealer_finance_direction",
      extractor: "finance_direction",
      targetFields: ["direction"],
    },
    {
      id: "dealer_finance_resource_type",
      extractor: "finance_resource_type",
      targetFields: ["resource_type"],
    },
    {
      id: "dealer_lead_intention_level",
      extractor: "lead_intention_level",
      targetFields: ["intention_level"],
    },
    {
      id: "dealer_lead_source",
      extractor: "lead_source",
      targetFields: ["source"],
    },
    // ── 域特定高级规则 ──
    {
      id: "dealer_vehicle_model_alias",
      extractor: "vehicle_model",
      targetFields: ["vehicle_model", "model", "series", "interested_series"],
      normalizeExtractor: "normalize_series",
    },
    {
      id: "dealer_status_disambiguate",
      extractor: "generic_status",
      targetFields: ["status"],
      disambiguate: [
        { pattern: "交付|交车", field: "delivery_status" },
        { pattern: "结清|定金|收款|付款", field: "payment_status" },
      ],
    },
    {
      id: "dealer_owner_reset",
      extractor: "",
      targetFields: [],
      textPattern: "其他销售|别的销售|换个销售",
      setValue: null,
      setFields: ["owner", "owner_name"],
    },
  ],

  // ── 前端组件渲染器 ──
  chatPageRenderers: [
    {
      name: "DealerVehicleProgress",
      code: `(function(surface, props) {
      var orders = Array.isArray(props.orders) ? props.orders : [];
      var summary = props.summary || {};
      if (!orders.length) return null;
      var card = materialCard("车辆交付进度", "由 OpenUI Bridge 映射到本地车辆进度物料");
      var metrics = document.createElement("div");
      metrics.className = "material-metrics";
      metrics.append(
        materialMetric(summary.total ?? orders.length, "相关订单"),
        materialMetric(summary.pending_delivery ?? "-", "待交付/整备"),
        materialMetric(summary.unpaid ?? "-", "未结清")
      );
      card.appendChild(metrics);
      var list = document.createElement("div");
      list.className = "material-list";
      orders.slice(0, 6).forEach(function(order) {
        var item = document.createElement("div");
        item.className = "material-item";
        var title = document.createElement("div");
        title.className = "material-item-title";
        title.textContent = clean([order.customer_name || "客户", [order.series, order.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "));
        var row = document.createElement("div");
        row.className = "material-row";
        row.append(
          materialChip("订单 " + clean(order.id || "-")),
          materialChip("交付 " + clean(order.delivery_status || order.order_status || "-")),
          materialChip("收款 " + clean(order.payment_status || "-"))
        );
        var action = document.createElement("div");
        action.className = "material-action";
        var nextAction = (function(o) {
          if ((o.payment_status || "") !== "已结清") return "优先跟进尾款/金融放款到账";
          if ((o.invoice_status || "") !== "已开票") return "确认开票节点";
          if ((o.delivery_status || "") !== "已交付") return "确认整备、上牌和交付排期";
          return "已完成交付，保持客户回访";
        })(order);
        action.textContent = "下一步：" + nextAction;
        var timeline = renderMaterialTimeline(order.timeline || []);
        item.append(title, row);
        if (timeline) item.appendChild(timeline);
        item.appendChild(action);
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    })`,
    },
  ],

  // 经营管理动作类问题（业务管理用语，不属于通用语言学模式）
  agenticQuestionPatterns: [
    /(经营复盘|晨会|看板|仪表盘|红黄绿|健康度|监控|计划|行动项|管理动作|下周|推进|落地|整改)/,
  ],

  // ── 本地 LLM 启发式：销售相关的敏感数据外泄词 ──
  dangerousQuestionKeywords: ["全部客户", "所有客户"],

  // ── 本地 LLM 启发式：知识库重要句关键词（销售类） ──
  importantSentenceKeywords: ["订单", "客户"],

  localPlannerHeuristics: [
    {
      id: "dealer.personal_customer_overview",
      priority: 50,
      matches(question: string): boolean {
        const text = String(question ?? "");
        const mentionsOwnedCustomers = /(我的|名下|负责|我负责).{0,10}客户/.test(text)
          || /客户.{0,10}(我的|名下|负责|我负责)/.test(text);
        const asksForActionableReview = /(订单|跟进|优先|最近|情况|风险|续签|待跟进|看看|检查|分析)/.test(text);
        return mentionsOwnedCustomers && asksForActionableReview;
      },
      buildPlan() {
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
                  "id", "name", "tier", "industry", "industry_category",
                  "deal_status", "follow_status", "renewal_status",
                  "annual_revenue", "last_contacted_at", "next_follow_up_at",
                  "contract_expire_at",
                ],
                sort: [{ field: "next_follow_up_at", direction: "asc" }],
                limit: 20,
                display: {
                  domain: "sales",
                  target: "customers",
                  operation: "search",
                  reason: "先查询当前用户可访问的客户，再结合订单判断优先跟进项。",
                },
              },
            },
            {
              name: "query_business_data",
              args: {
                resource: "orders",
                operation: "search",
                filters: [],
                metrics: [],
                fields: [
                  "id", "customer_id", "customer_name", "status",
                  "amount", "created_at", "expected_delivery",
                ],
                sort: [{ field: "created_at", direction: "desc" }],
                limit: 20,
                display: {
                  domain: "sales",
                  target: "orders",
                  operation: "search",
                  reason: "继续查询授权客户的最近订单，用于动态观察和回答。",
                },
              },
            },
          ],
          reason: "这是客户经营类综合问题，先查可访问客户和最近订单，再进行观察与归纳。",
        };
      },
    },
  ],

  // ── User field sources（intent manifest param_mapping source 注册） ──
  userFieldSources: [
    {
      name: "default_store",
      read(user) {
        return (user as { default_store?: string } | undefined)?.default_store ?? null;
      },
    } satisfies UserFieldSourceDefinition,
  ],

  // ── 场景注册（通过 register() 逃生口） ──
  register(_ctx) {
    // 注册 Surface 组件映射
    registerComponentMapping("vehicle_progress", "DealerVehicleProgress");
  },
};

/**
 * 判断消息是否为经销商经营分析类问题。
 * 从 src/agent/intent-codes.ts 迁移而来。
 */
function isDealerAnalysisMessage(message: string): boolean {
  const text = String(message ?? "");
  if (/(谁|哪位).{0,8}(负责人|主管|经理|总经理)|(?:负责人|主管|经理|总经理).{0,8}(是谁|哪位|谁)/.test(text)) return false;
  const hasAnalysisView = /(经营|分析|日报|周报|复盘|最该关注|优先级|看板|总览|汇总|建议|总经理|体系|晨会|行动项|经营计划|负责人|管理动作|协调问题)/.test(text);
  const hasRiskReview = /风险/.test(text) && /(经营|总览|复盘|分析|有哪些|哪里|最该关注|优先级)/.test(text);
  const hasManagementTask = /(晨会|行动项|经营计划|管理动作|协调问题|负责人|总经理视角|经销商体系)/.test(text);
  return (hasAnalysisView || hasRiskReview)
    && (hasManagementTask || /(经销商|门店|销售订单|库存|线索|售后|财务|三包|折让金|华东旗舰店|华南标准店)/.test(text));
}

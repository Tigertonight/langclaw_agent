import { card, list, openUIView, readArray, readPath, text, toRecord, type OpenUILangCompatComponentInstance, type SurfaceBuildOutput, type SurfacePlugin } from "../../../openui-lang/compat.js";
import type { JsonObject, JsonValue } from "../../../types/agent-contracts.js";

type CloudSurfaceKind = "executive" | "solution" | "quote" | "estimate" | "product_model" | "productization" | "offer_design" | "entitlement_review" | "channel_publication" | "sre_launch_gate" | "master_data_impact" | "financial_review" | "customer_explanation" | "change_impact" | "post_launch_health" | "ipd_readiness" | "gtm_package" | "capacity_risk" | "gmv_target" | "ops_impact" | "degradation_plan" | "overage_policy" | "retrospective_template" | "release_risk" | "approval" | "closed_loop" | "release_draft" | "query";

interface CloudSurfaceData {
  kind: CloudSurfaceKind;
  title: string;
  tool: string;
  viewComponent: "AnalyticsDashboardSurface" | "MetricCardsSurface" | "RiskListSurface" | "DataTableSurface" | "ProductLaunchFormSurface" | "GroupedListSurface" | "TagListSurface";
  viewProps: JsonObject;
  summaryLines: string[];
  sourceLabels: string[];
}

const CLOUD_TOOL_NAMES = new Set([
  "estimate_agent_plan_rounds",
  "estimate_seedance_video_seconds",
  "cloud_product_model_draft",
  "cloud_productization_readiness_review",
  "cloud_offer_design_review",
  "cloud_plan_entitlement_review",
  "cloud_channel_publication_review",
  "cloud_sre_launch_gate_review",
  "cloud_master_data_impact_review",
  "cloud_financial_commercialization_review",
  "cloud_customer_explanation",
  "cloud_product_change_impact_review",
  "cloud_post_launch_health_check",
  "cloud_ipd_readiness_review",
  "cloud_gtm_package_draft",
  "cloud_capacity_risk_review",
  "cloud_gmv_target_briefing",
  "cloud_ops_incident_business_impact",
  "cloud_ops_degradation_plan",
  "cloud_agent_plan_overage_policy",
  "cloud_retrospective_template",
  "cloud_executive_briefing",
  "cloud_solution_recommendation",
  "cloud_self_service_quote",
  "cloud_release_risk_review",
  "create_cloud_release_draft",
  "create_cloud_approval_summary",
  "simulate_cloud_closed_loop"
]);

const BLOCKED_STATUS = new Set(["blocked", "blocked_until_approval"]);

export const cloudCommodityOpenUIPlugin: SurfacePlugin<CloudSurfaceData> = {
  kind: "cloud_commodity_openui",
  extract: (ctx) => extractCloudSurfaceData(ctx.record),
  build: (data, ctx) => buildCloudSurface(data, ctx)
};

function extractCloudSurfaceData(record: Record<string, unknown>): CloudSurfaceData | null {
  const result = selectCloudResult(record);
  if (!result) return null;
  const tool = normalizeToolName(result.tool);
  const data = unwrapToolData(toRecord(result.data) ?? toRecord(result) ?? {});
  if (tool === "cloud_executive_briefing") return executiveSurface(data, tool);
  if (tool === "cloud_solution_recommendation") return solutionSurface(data, tool);
  if (tool === "cloud_self_service_quote") return quoteSurface(data, tool);
  if (tool === "estimate_agent_plan_rounds" || tool === "estimate_seedance_video_seconds") return estimateSurface(data, tool);
  if (tool === "cloud_product_model_draft") return productModelSurface(data, tool);
  if (tool === "cloud_productization_readiness_review") return productizationSurface(data, tool);
  if (tool === "cloud_offer_design_review") return offerDesignSurface(data, tool);
  if (tool === "cloud_plan_entitlement_review") return entitlementReviewSurface(data, tool);
  if (tool === "cloud_channel_publication_review") return channelPublicationSurface(data, tool);
  if (tool === "cloud_sre_launch_gate_review") return sreLaunchGateSurface(data, tool);
  if (tool === "cloud_master_data_impact_review") return genericReviewSurface(data, tool, "master_data_impact", "云主数据变更影响评审", "master_data_impact");
  if (tool === "cloud_financial_commercialization_review") return genericReviewSurface(data, tool, "financial_review", "云商品财务商业化评审", "financial_review");
  if (tool === "cloud_customer_explanation") return genericReviewSurface(data, tool, "customer_explanation", "云客户解释工作台", "customer_explanation");
  if (tool === "cloud_product_change_impact_review") return genericReviewSurface(data, tool, "change_impact_review", "云商品版本变更影响评审", "change_impact");
  if (tool === "cloud_post_launch_health_check") return genericReviewSurface(data, tool, "post_launch_health", "云商品发布后巡检", "post_launch_health");
  if (tool === "cloud_ipd_readiness_review") return ipdReadinessSurface(data, tool);
  if (tool === "cloud_gtm_package_draft") return gtmPackageSurface(data, tool);
  if (tool === "cloud_capacity_risk_review") return capacityRiskSurface(data, tool);
  if (tool === "cloud_gmv_target_briefing") return gmvTargetSurface(data, tool);
  if (tool === "cloud_ops_incident_business_impact") return opsImpactSurface(data, tool);
  if (tool === "cloud_ops_degradation_plan") return degradationPlanSurface(data, tool);
  if (tool === "cloud_agent_plan_overage_policy") return overagePolicySurface(data, tool);
  if (tool === "cloud_retrospective_template") return retrospectiveTemplateSurface(data, tool);
  if (tool === "cloud_release_risk_review") return releaseRiskSurface(data, tool);
  if (tool === "create_cloud_approval_summary") return approvalSurface(data, tool);
  if (tool === "simulate_cloud_closed_loop") return closedLoopSurface(data, tool);
  if (tool === "create_cloud_release_draft") return releaseDraftSurface(data, tool);
  if (tool === "query_business_data") return cloudQuerySurface(result);
  return null;
}

function selectCloudResult(record: Record<string, unknown>): JsonObject | null {
  const output = toRecord(record.output) ?? {};
  const debug = toRecord(record.debug) ?? toRecord(output.debug) ?? {};
  const context = toRecord(output._openui_lang_context) ?? toRecord(output._a2ui_context) ?? {};
  const candidates = [
    ...readArray(record.tool_results),
    ...readArray(output.tool_results),
    ...readArray(debug.tool_results),
    ...readArray(context.tool_results),
    toRecord(output),
    toRecord(record)
  ].filter((item): item is JsonObject => Boolean(item));
  return candidates.reverse().find(isCloudToolResult) ?? null;
}

function isCloudToolResult(result: JsonObject): boolean {
  const tool = normalizeToolName(result.tool ?? result.name);
  if (CLOUD_TOOL_NAMES.has(tool)) return true;
  if (tool === "query_business_data") {
    const resource = String(result.resource ?? readPath(result, ["data", "resource"]) ?? "");
    return resource.startsWith("cloud_");
  }
  return false;
}

function normalizeToolName(value: unknown): string {
  return String(value ?? "").replace(/^tool\./, "");
}

function unwrapToolData(value: JsonObject): JsonObject {
  const nested = toRecord(value.data);
  if (nested && (typeof value.tool === "string" || value.ok === true || value.ok === false)) return nested;
  return value;
}

function executiveSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const briefing = toRecord(data.executive_briefing) ?? data;
  const metrics = operatingMetrics(toRecord(briefing.operating_snapshot) ?? {});
  const topRisks = riskItems(readArray(briefing.top_risks), "高优先级风险");
  const blocking = readArray(briefing.blocking_tasks).map((item, index) => ({
    name: friendly(item.task_name ?? item.step ?? `任务 ${index + 1}`),
    owner: friendly(item.owner ?? item.owner_team_label),
    status: friendly(item.status_label ?? item.status),
    delay: Number(item.delay_hours ?? 0),
    action: friendly(item.next_action ?? item.blocker_reason ?? "需要明确处理动作")
  }));
  const renewals = readArray(briefing.renewal_risks).map((item) => ({
    customer: friendly(item.customer_name ?? item.customer_id),
    owner: friendly(item.owner),
    amount: formatCurrency(item.arr_at_risk_cny),
    risk: friendly(item.risk_level)
  }));
  return {
    kind: "executive",
    title: "云商品经营驾驶舱",
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: "云商品经营驾驶舱",
      metrics,
      tags: [
        tag("经营口径", "本月样本", "info"),
        tag("高优先级风险", topRisks.length, topRisks.length ? "danger" : "good"),
        tag("阻塞流程", blocking.length, blocking.length ? "warn" : "good"),
        tag("续约风险", renewals.length, renewals.length ? "warn" : "good")
      ],
      charts: [
        {
          kind: "bar",
          title: "风险/阻塞/续约数量",
          xKey: "类型",
          yKey: "数量",
          series: [
            { 类型: "风险", 数量: topRisks.length },
            { 类型: "流程阻塞", 数量: blocking.length },
            { 类型: "续约风险", 数量: renewals.length }
          ]
        },
        {
          kind: "bar",
          title: "经营指标快照",
          xKey: "指标",
          yKey: "数值",
          series: metrics
            .map((item) => ({ 指标: item.label, 数值: Number(String(item.value).replace(/[^\d.-]/g, "")) }))
            .filter((item) => Number.isFinite(item.数值))
        }
      ],
      rows: [
        ...topRisks.map((risk) => ({ 类型: "风险", 内容: risk.message, 负责人: risk.owner, 影响: risk.impact })),
        ...blocking.map((task) => ({ 类型: "流程", 内容: task.name, 负责人: task.owner, 影响: task.delay > 0 ? `延期 ${task.delay} 小时` : task.status })),
        ...renewals.map((item) => ({ 类型: "续约", 内容: item.customer, 负责人: item.owner, 影响: item.amount }))
      ],
      columns: [
        { key: "类型", label: "类型", type: "text" },
        { key: "内容", label: "内容", type: "text" },
        { key: "负责人", label: "负责人", type: "text" },
        { key: "影响", label: "影响", type: "text" }
      ],
      insights: [
        { title: "结论", summary: friendly(briefing.conclusion) },
        ...readStringArray(briefing.next_actions).slice(0, 4).map((action, index) => ({ title: `动作 ${index + 1}`, summary: action })),
        { title: "数据边界", summary: friendly(briefing.data_boundary) }
      ]
    },
    summaryLines: [
      friendly(briefing.conclusion),
      `续约风险金额：${formatCurrency(briefing.amount_at_risk_cny)}`,
      ...topRisks.slice(0, 3).map((risk) => `${risk.level}：${risk.message}，负责人 ${risk.owner}`)
    ],
    sourceLabels: sourceLabels(briefing)
  };
}

function solutionSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const solution = toRecord(data.solution) ?? data;
  const plan = readArray(solution.package_plan).map((item) => ({
    产品: friendly(item.product_name ?? item.product_code),
    预算: Number(item.budget_cny ?? 0),
    占比: formatPercent(item.ratio),
    组合理由: friendly(item.reason)
  }));
  return {
    kind: "solution",
    title: "云商品方案推荐",
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: "云商品方案推荐",
      metrics: [
        metric("预算", solution.budget_cny, "元"),
        metric("方案置信度", solution.confidence, ""),
        metric("推荐产品数", plan.length, "项")
      ],
      tags: [
        tag("方案状态", "草稿", "info"),
        tag("报价属性", "非正式报价", "warn"),
        tag("人审要求", "合同/折扣复核", "warn")
      ],
      charts: [
        {
          kind: "pie",
          title: "预算分配",
          categoryKey: "产品",
          valueKey: "预算值",
          series: plan.map((item) => ({ 产品: item.产品, 预算值: Number(item.预算 ?? 0) }))
        }
      ],
      rows: plan,
      columns: columns(["产品", "预算", "占比", "组合理由"]),
      insights: [
        ...readStringArray(solution.assumptions).slice(0, 4).map((item, index) => ({ title: `关键假设 ${index + 1}`, summary: item })),
        { title: "报价边界", summary: friendly(solution.boundary) },
        { title: "置信度", summary: formatConfidence(solution.confidence) }
      ]
    },
    summaryLines: [
      `预算：${formatCurrency(solution.budget_cny)}`,
      `推荐组合：${plan.map((item) => String(item.产品)).join("、")}`,
      `置信度：${formatConfidence(solution.confidence)}`
    ],
    sourceLabels: ["商品目录", "价格证据", "演示估算假设"]
  };
}

function quoteSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const quote = toRecord(data.quote) ?? data;
  const seedance = toRecord(readPath(quote, ["seedance", "data", "estimate"])) ?? {};
  const agentPlan = toRecord(readPath(quote, ["agent_plan", "data", "estimate"])) ?? {};
  const metrics = [
    metric("预计视频秒数", seedance.estimated_video_seconds ?? seedance.estimated_seconds, "秒"),
    metric("可生成视频条数", seedance.estimated_video_count, "条"),
    metric("预计对话轮数", agentPlan.estimated_rounds, "轮"),
    metric("询价置信度", averageConfidence(seedance.confidence, agentPlan.confidence), "")
  ];
  const rows = [
    { 项目: "Seedance 视频生成", 公式: friendly(seedance.formula), 关键假设: summarizeObject(seedance.assumptions), 边界: friendly(seedance.boundary) },
    { 项目: "Agent Plan 对话", 公式: friendly(agentPlan.formula), 关键假设: summarizeObject(agentPlan.assumptions), 边界: friendly(agentPlan.boundary) }
  ];
  return {
    kind: "quote",
    title: "云商品自助询价",
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: "云商品自助询价",
      metrics,
      tags: [
        tag("报价状态", "估算草稿", "info"),
        tag("正式报价", "需销售复核", "warn"),
        tag("产能承诺", "不承诺固定产能", "danger")
      ],
      charts: [
        {
          kind: "bar",
          title: "估算产出",
          xKey: "项目",
          yKey: "数量",
          series: [
            { 项目: "视频秒数", 数量: Number(seedance.estimated_video_seconds ?? seedance.estimated_seconds ?? 0) },
            { 项目: "视频条数", 数量: Number(seedance.estimated_video_count ?? 0) },
            { 项目: "对话轮数", 数量: Number(agentPlan.estimated_rounds ?? 0) }
          ]
        }
      ],
      rows,
      columns: columns(["项目", "公式", "关键假设", "边界"]),
      insights: [
        { title: "报价边界", summary: friendly(quote.disclaimer) },
        { title: "数据说明", summary: "以下结果为演示估算，不是正式报价或固定产能承诺。" }
      ]
    },
    summaryLines: [
      `预计视频：${formatNumber(seedance.estimated_seconds)} 秒`,
      `预计对话：${formatNumber(agentPlan.estimated_rounds)} 轮`,
      "正式报价前需要复核合同、地域、资源包、内容安全审核和实际调用形态。"
    ],
    sourceLabels: ["估算器", "价格样本", "演示假设"]
  };
}

function estimateSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const estimate = toRecord(data.estimate) ?? data;
  const isAgent = tool === "estimate_agent_plan_rounds";
  const title = isAgent ? "Agent Plan 轮数估算" : "Seedance 视频秒数估算";
  const rows = [
    { 项目: "计算公式", 内容: friendly(estimate.formula) },
    { 项目: "关键假设", 内容: summarizeObject(estimate.assumptions) },
    { 项目: "报价边界", 内容: friendly(estimate.boundary) },
    { 项目: "置信度", 内容: formatConfidence(estimate.confidence) }
  ];
  return {
    kind: "estimate",
    title,
    tool,
    viewComponent: "MetricCardsSurface",
    viewProps: {
      title,
      metrics: isAgent
        ? [metric("预计对话轮数", estimate.estimated_rounds, "轮"), metric("可用额度", estimate.available_afp, "AFP"), metric("置信度", estimate.confidence, "")]
        : [metric("预计视频秒数", estimate.estimated_video_seconds ?? estimate.estimated_seconds, "秒"), metric("可生成视频条数", estimate.estimated_video_count, "条"), metric("置信度", estimate.confidence, "")]
    },
    summaryLines: rows.map((row) => `${row.项目}：${row.内容}`),
    sourceLabels: ["估算器", "价格样本", "演示假设"]
  };
}

function productModelSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const draft = toRecord(data.draft) ?? data;
  const product = toRecord(draft.product) ?? {};
  const offers = readArray(draft.offers);
  const skus = readArray(draft.skus);
  const meters = readArray(draft.meters);
  const prices = readArray(draft.prices);
  const fields = readArray(draft.purchase_page_fields).map((item) => ({
    字段: friendly(item.label ?? item.field),
    是否必填: item.required === true ? "必填" : "可选",
    说明: friendly(item.unit ? `单位：${item.unit}` : "按购买页配置"),
    来源: sourceName(item.source)
  }));
  const rows = fields.length ? fields : [
    { 字段: "商品", 是否必填: "必填", 说明: friendly(product.product_name ?? product.product_code), 来源: "商品目录" }
  ];
  return {
    kind: "product_model",
    title: `${friendly(product.product_name ?? product.product_code ?? "云商品")} 上架工作台`,
    tool,
    viewComponent: "ProductLaunchFormSurface",
    viewProps: {
      title: `${friendly(product.product_name ?? product.product_code ?? "云商品")} 上架工作台`,
      product_name: friendly(product.product_name ?? product.product_code ?? "云商品"),
      status_label: "草稿待确认",
      guide: "请先补齐必填字段、计费规则、权益边界和审核口径；本页面只生成草稿/审批摘要，不会直接上架生产。",
      sections: [
        {
          title: "1. 商品基础信息",
          description: "确认商品对外名称、品类、供应商口径和说明文案。",
          fields: [
            launchField("product_name", "商品名称", product.product_name ?? product.product_code, true, "已识别", "用户输入/商品草稿"),
            launchField("product_category", "商品品类", product.product_category ?? "AI 模型商品", true, "待确认", "商品建模"),
            launchField("provider", "供应商口径", product.provider ?? "demo provider", true, "待确认", "演示数据"),
            launchField("description", "商品说明", product.description ?? "新模型商品建模草稿", false, "可补充", "用户输入")
          ]
        },
        {
          title: "2. 购买页配置",
          description: "这些字段会影响客户下单体验和后续计费校验。",
          fields: rows.slice(0, 12).map((row, index) => launchField(
            `purchase_${index + 1}`,
            row.字段,
            row.说明,
            row.是否必填 === "必填",
            row.是否必填 === "必填" ? "待确认" : "可选",
            row.来源
          ))
        },
        {
          title: "3. 售卖与计费规则",
          description: "正式报价前必须完成财务复核，避免赠送额度、促销和合同折扣叠加造成争议。",
          fields: [
            launchField("offers", "售卖方式", listField(offers, "offer_name") || "按量/资源包/会员权益待确认", true, "待复核", "Offer 草稿"),
            launchField("skus", "套餐/SKU", listField(skus, "sku_name") || "SKU 待拆分", true, "待复核", "SKU 草稿"),
            launchField("meters", "计量项", listField(meters, "meter_name") || "计量项待确认", true, "待复核", "计量项草稿"),
            launchField("prices", "价格规则", listField(prices, "price_name") || "价格待复核", true, "财务复核", "价格草稿")
          ]
        }
      ],
      missing_items: readStringArray(draft.missing_fields).map(friendly),
      review_notes: readStringArray(draft.review_notes).map(friendly),
      actions: [
        { label: "补齐必填字段", detail: "先确认模型成本底线、Token 计量、会员赠送额度和内容安全策略。", tone: "primary", disabled: true },
        { label: "生成发布草稿", detail: "草稿仅进入审批前检查，不会写入生产商品目录。", tone: "secondary", disabled: true },
        { label: "进入人工审批", detail: "财务、法务/SRE 和商品负责人确认后，再进入正式上架流程。", tone: "secondary", disabled: true }
      ],
      evidence_label: "商品目录 / 规格 / 计量项 / 价格样本",
      boundary_label: friendly(draft.data_boundary ?? "新商品建模结果为 demo/草稿，不代表正式价格、正式库存、SLA 或已完成上架。")
    },
    summaryLines: [
      `商品：${friendly(product.product_name ?? product.product_code)}`,
      `购买页字段：${rows.length} 项`,
      `待补齐：${readStringArray(draft.missing_fields).map(friendly).join("、") || "暂无明显缺口"}`,
      ...readStringArray(draft.review_notes).slice(0, 2)
    ],
    sourceLabels: ["商品目录", "规格", "计量项", "价格样本", "来源引用"]
  };
}

function launchField(key: string, label: unknown, value: unknown, required: boolean, status: string, source: unknown): JsonObject {
  return {
    key,
    label: friendly(label),
    value: friendly(value),
    required,
    status,
    source: friendly(source),
    input_type: "text"
  };
}

function listField(rows: JsonObject[], field: string): string {
  return rows.slice(0, 4).map((row) => friendly(row[field])).filter((value) => value && value !== "-").join("、");
}

function productizationSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const review = toRecord(data.productization_review) ?? data;
  const product = toRecord(review.product) ?? {};
  const rawReview = toRecord(review.review) ?? {};
  const productName = friendly(product.product_name ?? rawReview.product_name ?? "云产品能力");
  const deliverables = readArray(review.deliverables).map((item, index) => ({
    name: friendly(item.name ?? `交付物 ${index + 1}`),
    status: friendly(item.status_label ?? item.status),
    owner: friendly(item.owner),
    value: friendly(item.gap ?? item.next_action ?? "待确认"),
    required: item.status !== "completed",
    source: "产品化定义评审",
    input_type: "text"
  }));
  return {
    kind: "productization",
    title: `${productName} 产品化定义工作台`,
    tool,
    viewComponent: "ProductLaunchFormSurface",
    viewProps: {
      title: `${productName} 产品化定义工作台`,
      product_name: productName,
      status_label: friendly(review.overall_status),
      guide: "先判断技术/模型能力是否被定义成合格产品，再进入商品主数据、Offer、渠道发布和 SRE 上架门禁；本页只生成草稿和评审建议。",
      sections: [
        {
          title: "1. 产品化定义",
          description: "把能力说清楚：服务谁、解决什么问题、边界在哪里。",
          fields: [
            launchField("target_customers", "目标客户", friendly(review.target_customers), true, "待确认", "产品化评审"),
            launchField("value_proposition", "客户价值", review.value_proposition, true, "待确认", "产品化评审"),
            launchField("capability_stage", "能力阶段", rawReview.capability_stage, true, "待确认", "产品化评审"),
            launchField("sla_draft", "SLA 初稿", review.sla_draft, true, "法务/SRE复核", "产品化评审")
          ]
        },
        {
          title: "2. 交付物与负责人",
          description: "这些交付物决定是否能成为定义合格、可售卖、可交付的产品。",
          fields: deliverables
        },
        {
          title: "3. 成本和能力边界",
          description: "先把不能承诺的事情写进产品定义，避免后续官网、销售和合同误承诺。",
          fields: [
            launchField("boundary_items", "不可承诺项", friendly(review.boundary_items), true, "待复核", "产品化评审"),
            launchField("cost_inputs", "成本测算输入", friendly(review.cost_inputs), true, "财务复核", "产品化评审")
          ]
        }
      ],
      missing_items: readArray(review.blockers).map((item) => friendly(item.gap ?? item.name)).filter(Boolean),
      review_notes: readStringArray(review.next_actions),
      actions: [
        { label: "生成产品定义草稿", detail: "沉淀目标客户、价值主张、能力边界、成本输入和 SLA 初稿。", tone: "primary", disabled: true },
        { label: "进入人工复核", detail: "商品 PM、财务、法务和 SRE 确认后再进入商品化上架。", tone: "secondary", disabled: true }
      ],
      evidence_label: "产品化定义评审 / 产品主数据 / 来源引用",
      boundary_label: friendly(review.data_boundary)
    },
    summaryLines: [
      `${productName} 产品化就绪度约 ${formatNumber(review.readiness_score)}%，当前状态为「${friendly(review.overall_status)}」。`,
      `目标客户：${friendly(review.target_customers)}`,
      `待补交付物：${readArray(review.blockers).map((item) => friendly(item.name)).join("、") || "暂无"}`,
      `数据边界：${friendly(review.data_boundary)}`
    ],
    sourceLabels: sourceLabels(review)
  };
}

function offerDesignSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const review = toRecord(data.offer_design_review) ?? data;
  const productName = friendly(readPath(review, ["product", "product_name"]) ?? "云商品");
  const rows = readArray(review.relation_rows).map((item) => ({
    Offer: friendly(item.offer_name),
    计费模式: friendly(item.billing_mode),
    购买方式: friendly(item.purchase_mode),
    SKU: friendly(item.skus),
    计量项: friendly(item.meters),
    价格关系: friendly(item.prices)
  }));
  const conflicts = readStringArray(review.conflicts);
  return {
    kind: "offer_design",
    title: `${productName} Offer 治理评审`,
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: `${productName} Offer 治理评审`,
      metrics: [
        metric("Offer", readArray(review.offers).length, "个"),
        metric("SKU", readArray(review.skus).length, "个"),
        metric("计量项", readArray(review.meters).length, "个"),
        metric("冲突点", conflicts.length, "项")
      ],
      tags: [
        tag("评审状态", conflicts.length ? "需治理" : "可继续", conflicts.length ? "warn" : "good"),
        tag("动作属性", "草稿/审批摘要", "info"),
        tag("价格生效", "人工确认后", "warn")
      ],
      charts: [{
        kind: "bar",
        title: "Offer 关系对象数量",
        xKey: "对象",
        yKey: "数量",
        series: [
          { 对象: "Offer", 数量: readArray(review.offers).length },
          { 对象: "SKU", 数量: readArray(review.skus).length },
          { 对象: "计量项", 数量: readArray(review.meters).length },
          { 对象: "价格", 数量: readArray(review.prices).length }
        ]
      }],
      rows,
      columns: columns(["Offer", "计费模式", "购买方式", "SKU", "计量项", "价格关系"]),
      insights: [
        ...conflicts.slice(0, 4).map((item, index) => ({ title: `重点事项 ${index + 1}`, summary: item })),
        ...readStringArray(review.next_actions).slice(0, 4).map((item, index) => ({ title: `动作 ${index + 1}`, summary: item })),
        { title: "数据边界", summary: friendly(review.data_boundary) }
      ]
    },
    summaryLines: [
      `${productName} 已梳理 ${rows.length} 个 Offer 关系，发现 ${conflicts.length} 个治理重点。`,
      "按量、包月、会员权益和超额付费可以并存，但必须拆清 Offer、权益和二次确认。",
      `数据边界：${friendly(review.data_boundary)}`
    ],
    sourceLabels: sourceLabels(review)
  };
}

function entitlementReviewSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const review = toRecord(data.entitlement_review) ?? data;
  const productName = friendly(readPath(review, ["product", "product_name"]) ?? "Plan 型商品");
  const rules = readArray(review.rules);
  const sections = rules.map((rule, index) => ({
    title: `${index + 1}. ${friendly(rule.entitlement_name)}`,
    description: "权益规则必须能被购买页、账单页、客服和销售同时解释清楚。",
    fields: [
      launchField(`grant_${index}`, "额度发放", rule.grant_rule, true, "待确认", "套餐权益规则"),
      launchField(`consume_${index}`, "消耗顺序", rule.consume_order, true, "待确认", "套餐权益规则"),
      launchField(`expiry_${index}`, "过期规则", rule.expiry_rule, true, "待确认", "套餐权益规则"),
      launchField(`unsubscribe_${index}`, "退订规则", rule.unsubscribe_rule, true, "待复核", "套餐权益规则"),
      launchField(`refund_${index}`, "退款规则", rule.refund_rule, true, "财务/法务复核", "套餐权益规则"),
      launchField(`overage_${index}`, "超额策略", rule.overage_policy, true, "客户二次确认", "套餐权益规则"),
      launchField(`billing_${index}`, "账单解释", rule.billing_explanation, true, "客户友好解释", "套餐权益规则")
    ]
  }));
  return {
    kind: "entitlement_review",
    title: `${productName} 权益规则工作台`,
    tool,
    viewComponent: "ProductLaunchFormSurface",
    viewProps: {
      title: `${productName} 权益规则工作台`,
      product_name: productName,
      status_label: readArray(review.risk_items).length ? "需人工复核" : "可继续",
      guide: "Plan 型产品的核心不是单价，而是额度如何发、怎么扣、何时过期、退订退款怎么解释、超额是否二次确认。",
      sections,
      missing_items: readStringArray(review.risk_items),
      review_notes: readStringArray(review.next_actions),
      actions: [
        { label: "生成权益规则草稿", detail: "生成发放、消耗、过期、退订、退款、超额和账单解释草稿。", tone: "primary", disabled: true },
        { label: "进入人工复核", detail: "财务、法务、客户成功确认后才能生效。", tone: "secondary", disabled: true }
      ],
      evidence_label: "套餐权益规则 / 产品主数据 / 来源引用",
      boundary_label: friendly(review.data_boundary)
    },
    summaryLines: [
      `${productName} 已梳理 ${rules.length} 条权益规则，需关注 ${readArray(review.risk_items).length} 个风险点。`,
      "默认不自动扣费，超额付费必须客户二次确认后只生成开通草稿。",
      `数据边界：${friendly(review.data_boundary)}`
    ],
    sourceLabels: sourceLabels(review)
  };
}

function channelPublicationSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const review = toRecord(data.channel_publication_review) ?? data;
  const productName = friendly(readPath(review, ["product", "product_name"]) ?? "云商品");
  const rows = readArray(review.channels).map((item) => ({
    渠道: friendly(item.channel),
    渠道目的: friendly(item.channel_purpose),
    可展示字段: friendly(item.visible_fields),
    禁展示字段: friendly(item.hidden_fields),
    数据源头: friendly(item.source_of_truth),
    发布状态: friendly(item.publication_status),
    负责人: friendly(item.owner),
    发布前检查: friendly(item.precheck)
  }));
  return {
    kind: "channel_publication",
    title: `${productName} 渠道发布矩阵`,
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: `${productName} 渠道发布矩阵`,
      metrics: [
        metric("渠道", rows.length, "个"),
        metric("需复核渠道", readArray(review.blocked_channels).length, "个"),
        metric("可见字段", rows.reduce((sum, row) => sum + friendly(row.可展示字段).split("、").filter(Boolean).length, 0), "项")
      ],
      tags: [
        tag("主数据源", "商品中台", "info"),
        tag("官网定位", "销售/营销渠道", "info"),
        tag("发布动作", "人工确认后", "warn")
      ],
      charts: [{
        kind: "bar",
        title: "渠道发布状态",
        xKey: "状态",
        yKey: "数量",
        series: countBy(rows, "发布状态").map(([状态, 数量]) => ({ 状态, 数量 }))
      }],
      rows,
      columns: columns(["渠道", "渠道目的", "可展示字段", "禁展示字段", "数据源头", "发布状态", "负责人", "发布前检查"]),
      insights: [
        { title: "结论", summary: "商品主数据来自商品中台；官网、控制台、销售报价、API/Marketplace 都是不同发布渠道。" },
        ...readStringArray(review.next_actions).slice(0, 4).map((item, index) => ({ title: `动作 ${index + 1}`, summary: item })),
        { title: "数据边界", summary: friendly(review.data_boundary) }
      ]
    },
    summaryLines: [
      `${productName} 已整理官网、控制台、销售报价和 API/Marketplace 共 ${rows.length} 个渠道。`,
      "官网是销售/营销渠道之一，不是商品主数据来源；商品主数据以商品中台为准。",
      `数据边界：${friendly(review.data_boundary)}`
    ],
    sourceLabels: sourceLabels(review)
  };
}

function sreLaunchGateSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const review = toRecord(data.sre_launch_gate_review) ?? data;
  const productName = friendly(readPath(review, ["product", "product_name"]) ?? "云商品");
  const rows = readArray(review.gates).map((item) => ({
    门禁: friendly(item.gate_name),
    状态: friendly(item.status_label ?? item.status),
    负责人: friendly(item.owner),
    指标: friendly(item.metric),
    阈值: friendly(item.threshold),
    缺失风险: friendly(item.risk_if_missing),
    后续动作: friendly(item.next_action),
    回滚条件: friendly(item.rollback_trigger),
    客户通知: friendly(item.customer_notice)
  }));
  return {
    kind: "sre_launch_gate",
    title: `${productName} SRE 上架门禁`,
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: `${productName} SRE 上架门禁`,
      metrics: [
        metric("门禁", rows.length, "项"),
        metric("阻塞/处理中", readArray(review.blockers).length, "项"),
        metric("已完成", rows.filter((row) => row.状态 === "已完成").length, "项")
      ],
      tags: [
        tag("稳定性", readArray(review.blockers).length ? "需复核" : "可继续", readArray(review.blockers).length ? "warn" : "good"),
        tag("动作属性", "巡检计划/审批摘要", "info"),
        tag("生产放量", "人工确认后", "warn")
      ],
      charts: [{
        kind: "bar",
        title: "门禁状态",
        xKey: "状态",
        yKey: "数量",
        series: countBy(rows, "状态").map(([状态, 数量]) => ({ 状态, 数量 }))
      }],
      rows,
      columns: columns(["门禁", "状态", "负责人", "指标", "阈值", "缺失风险", "后续动作", "回滚条件", "客户通知"]),
      insights: [
        ...readStringArray(review.next_actions).slice(0, 4).map((item, index) => ({ title: `动作 ${index + 1}`, summary: item })),
        { title: "数据边界", summary: friendly(review.data_boundary) }
      ]
    },
    summaryLines: [
      `${productName} SRE 门禁共 ${rows.length} 项，当前 ${readArray(review.blockers).length} 项需要复核。`,
      "容量、限流、告警、灰度、回滚和客户通知确认前，不建议直接放量。",
      `数据边界：${friendly(review.data_boundary)}`
    ],
    sourceLabels: sourceLabels(review)
  };
}

function genericReviewSurface(data: JsonObject, tool: string, dataKey: string, title: string, kind: CloudSurfaceKind): CloudSurfaceData | null {
  const review = toRecord(data[dataKey]) ?? data;
  const productName = friendly(readPath(review, ["product", "product_name"]) ?? "云商品");
  const rowSource = readArray(review.lineage).length ? readArray(review.lineage)
    : readArray(review.policies).length ? readArray(review.policies)
      : readArray(review.playbooks).length ? readArray(review.playbooks)
        : readArray(review.changes).length ? readArray(review.changes)
          : readArray(review.checks);
  const rows = rowSource.map((item) => friendlyRow(item));
  const blockers = readArray(review.blockers);
  const risks = readStringArray(review.risk_items);
  const nextActions = readStringArray(review.next_actions);
  const detailTitle = `${productName} ${title}`;
  return {
    kind,
    title: detailTitle,
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: detailTitle,
      metrics: [
        metric("明细", rows.length, "项"),
        metric("风险/阻塞", blockers.length + risks.length, "项"),
        metric("后续动作", nextActions.length, "项")
      ],
      tags: [
        tag("动作属性", "草稿/评审", "info"),
        tag("人工确认", "必需", "warn"),
        tag("生产变更", "不自动执行", "warn")
      ],
      rows,
      columns: inferFriendlyColumns(rows),
      insights: [
        ...risks.slice(0, 4).map((item, index) => ({ title: `重点事项 ${index + 1}`, summary: item })),
        ...nextActions.slice(0, 4).map((item, index) => ({ title: `动作 ${index + 1}`, summary: item })),
        { title: "数据边界", summary: friendly(review.data_boundary) }
      ]
    },
    summaryLines: [
      `${productName} 已生成${title}，共 ${rows.length} 条业务明细。`,
      risks.length ? `需关注：${risks.slice(0, 2).join("；")}` : "所有动作只生成评审、草稿或解释，不自动进入生产。",
      `数据边界：${friendly(review.data_boundary)}`
    ],
    sourceLabels: sourceLabels(review)
  };
}

function ipdReadinessSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const review = toRecord(data.ipd_readiness) ?? data;
  const productName = friendly(readPath(review, ["product", "product_name"]) ?? "云商品");
  const title = `${productName} IPD 上架就绪评审`;
  const checkpoints = readArray(review.checkpoints).map((item) => ({
    阶段: friendly(item.stage),
    检查点: friendly(item.checkpoint_name),
    状态: friendly(item.status_label ?? item.status),
    负责人: friendly(item.owner ?? item.owner_team),
    缺口: friendly(item.gap ?? "暂无"),
    下一步: friendly(item.next_action)
  }));
  return {
    kind: "ipd_readiness",
    title,
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title,
      metrics: [
        metric("就绪度", review.readiness_score, "%"),
        metric("检查点", checkpoints.length, "项"),
        metric("阻塞项", readArray(review.blockers).length, "项")
      ],
      tags: [
        tag("总体状态", friendly(review.overall_status), statusTone(review.overall_status)),
        tag("人工确认", "必需", "warn"),
        tag("数据边界", "demo/mock", "info")
      ],
      charts: [
        {
          kind: "bar",
          title: "IPD 状态分布",
          xKey: "状态",
          yKey: "数量",
          series: countBy(checkpoints, "状态").map(([状态, 数量]) => ({ 状态, 数量 }))
        }
      ],
      rows: checkpoints,
      columns: columns(["阶段", "检查点", "状态", "负责人", "缺口", "下一步"]),
      insights: [
        { title: "总体状态", summary: friendly(review.overall_status) },
        ...readStringArray(review.next_actions).slice(0, 4).map((item, index) => ({ title: `动作 ${index + 1}`, summary: item })),
        { title: "数据边界", summary: friendly(review.data_boundary) }
      ]
    },
    summaryLines: [
      `就绪度：${formatNumber(review.readiness_score)}%`,
      `阻塞项：${readArray(review.blockers).length} 项`,
      "价格、合规/运维和 GTM ready 需要人工确认后才能进入生产。"
    ],
    sourceLabels: ["IPD 检查点", "发布申请", "流程任务", "风险信号", "来源引用"]
  };
}

function gtmPackageSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const gtm = toRecord(data.gtm_package) ?? data;
  const productName = friendly(readPath(gtm, ["product", "product_name"]) ?? "云商品");
  const title = `${productName} GTM 销售包`;
  const assets = readArray(gtm.assets).map((item) => ({
    材料: friendly(item.title),
    类型: friendly(item.asset_type),
    受众: friendly(item.audience),
    状态: friendly(item.status),
    内容: friendly(item.content),
    不可承诺项: friendly(item.not_to_commit)
  }));
  const targetCustomers = readArray(gtm.target_customers);
  return {
    kind: "gtm_package",
    title,
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title,
      metrics: [
        metric("材料数", assets.length, "项"),
        metric("目标客户", targetCustomers.length, "类/个"),
        metric("置信度", gtm.confidence, "")
      ],
      tags: [
        tag("目标客户", friendly(gtm.industry), "info"),
        tag("销售材料", `${assets.length} 项`, assets.length ? "good" : "warn"),
        tag("不可承诺项", readStringArray(gtm.not_to_commit).length, "danger")
      ],
      charts: [
        {
          kind: "bar",
          title: "GTM 材料状态",
          xKey: "状态",
          yKey: "数量",
          series: countBy(assets, "状态").map(([状态, 数量]) => ({ 状态, 数量 }))
        }
      ],
      rows: assets,
      columns: columns(["材料", "类型", "受众", "状态", "内容", "不可承诺项"]),
      insights: [
        ...readStringArray(gtm.not_to_commit).slice(0, 4).map((item, index) => ({ title: `不可承诺 ${index + 1}`, summary: item })),
        ...readStringArray(gtm.quote_checklist).slice(0, 4).map((item, index) => ({ title: `报价前检查 ${index + 1}`, summary: item })),
        { title: "边界", summary: friendly(gtm.boundary) }
      ]
    },
    summaryLines: [
      `目标客户：${friendly(gtm.industry)}`,
      `GTM 材料：${assets.length} 项`,
      "正式报价前必须复核价格/用量、交付/运维、合规和合同边界。"
    ],
    sourceLabels: ["GTM 材料", "销售商机", "容量池", "演示假设"]
  };
}

function capacityRiskSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const review = toRecord(data.capacity_review) ?? data;
  const pools = readArray(review.capacity_pools).map((item) => ({
    地域: friendly(item.region_name),
    规格族: friendly(item.sku_family),
    可用GPU卡: formatNumber(item.available_gpu_cards),
    峰值覆盖率: formatPercent(item.peak_commitment_ratio),
    健康度: friendly(item.health_status),
    销售策略: friendly(item.sales_policy),
    下一步: friendly(item.next_action)
  }));
  const risks = riskItems(readArray(review.risks), "容量风险");
  return {
    kind: "capacity_risk",
    title: "ECS GPU 容量风险看板",
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: "ECS GPU 容量风险看板",
      metrics: [
        metric("地域容量池", pools.length, "个"),
        metric("高风险地域", pools.filter((item) => item.健康度 === "风险" || item.健康度 === "risk").length, "个"),
        metric("风险项", risks.length, "项")
      ],
      tags: [
        tag("容量策略", "灰度/限售", "warn"),
        tag("人审要求", "SRE 确认", "warn"),
        tag("风险项", risks.length, risks.length ? "danger" : "good")
      ],
      charts: [
        {
          kind: "bar",
          title: "地域可用 GPU 卡",
          xKey: "地域",
          yKey: "卡数",
          series: pools.map((item) => ({ 地域: item.地域, 卡数: Number(String(item.可用GPU卡).replace(/[^\d.-]/g, "")) || 0 }))
        },
        {
          kind: "bar",
          title: "地域峰值覆盖率",
          xKey: "地域",
          yKey: "覆盖率",
          series: pools.map((item) => ({ 地域: item.地域, 覆盖率: percentToNumber(item.峰值覆盖率) }))
        }
      ],
      rows: pools,
      columns: columns(["地域", "规格族", "可用GPU卡", "峰值覆盖率", "健康度", "销售策略", "下一步"]),
      insights: [
        ...readStringArray(review.sales_restrictions).slice(0, 4).map((item, index) => ({ title: `限售/灰度 ${index + 1}`, summary: item })),
        { title: "数据边界", summary: friendly(review.boundary) }
      ]
    },
    summaryLines: [
      `总体状态：${friendly(review.overall_status)}`,
      "新加坡需容量预约；华东 1 可灰度开放但仍需保留安全缓冲。",
      `风险项：${risks.length} 项`
    ],
    sourceLabels: ["容量池", "风险信号", "流程任务", "来源引用"]
  };
}

function gmvTargetSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const briefing = toRecord(data.gmv_briefing) ?? data;
  const productName = friendly(readPath(briefing, ["product", "product_name"]) ?? "云商品");
  const title = `${productName} GMV 目标驾驶舱`;
  const risks = riskItems(readArray(briefing.top_risks), "经营风险");
  const opportunities = readArray(briefing.opportunities).map((item) => ({
    客户: friendly(item.customer_name),
    阶段: friendly(item.stage),
    预算: formatCurrency(item.budget_cny),
    加权商机: formatCurrency(item.weighted_pipeline_cny),
    阻塞: friendly(item.blockers),
    下一步: friendly(item.next_action)
  }));
  return {
    kind: "gmv_target",
    title,
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title,
      metrics: [
        metric("GMV目标", briefing.target_cny, "元"),
        metric("已成交", briefing.booked_cny, "元"),
        metric("达成率", briefing.target_attainment_rate, ""),
        metric("目标缺口", briefing.gap_to_target_cny, "元"),
        metric("加权商机", briefing.weighted_pipeline_cny, "元"),
        metric("毛利率", briefing.gross_margin_rate, "")
      ],
      tags: [
        tag("目标达成", formatPercent(briefing.target_attainment_rate), Number(briefing.target_attainment_rate) >= 0.8 ? "good" : "warn"),
        tag("毛利健康", formatPercent(briefing.gross_margin_rate), Number(briefing.gross_margin_rate) >= 0.35 ? "good" : "warn"),
        tag("风险项", risks.length, risks.length ? "danger" : "good")
      ],
      charts: [
        {
          kind: "bar",
          title: "GMV 目标漏斗",
          xKey: "口径",
          yKey: "金额",
          series: [
            { 口径: "目标", 金额: Number(briefing.target_cny ?? 0) },
            { 口径: "已成交", 金额: Number(briefing.booked_cny ?? 0) },
            { 口径: "加权商机", 金额: Number(briefing.weighted_pipeline_cny ?? 0) },
            { 口径: "目标缺口", 金额: Number(briefing.gap_to_target_cny ?? 0) }
          ]
        },
        {
          kind: "bar",
          title: "商机加权金额",
          xKey: "客户",
          yKey: "金额",
          series: opportunities.map((item) => ({ 客户: item.客户, 金额: currencyToNumber(item.加权商机) }))
        }
      ],
      rows: opportunities,
      columns: columns(["客户", "阶段", "预算", "加权商机", "阻塞", "下一步"]),
      insights: [
        ...risks.slice(0, 4).map((risk) => ({ title: `${risk.level}风险`, summary: `${risk.message}；负责人 ${risk.owner}；${risk.impact}` })),
        ...readStringArray(briefing.next_actions).slice(0, 4).map((item, index) => ({ title: `动作 ${index + 1}`, summary: item })),
        { title: "数据边界", summary: friendly(briefing.data_boundary) }
      ]
    },
    summaryLines: [
      `目标达成率：${formatPercent(briefing.target_attainment_rate)}`,
      `目标缺口：${formatCurrency(briefing.gap_to_target_cny)}`,
      `毛利率：${formatPercent(briefing.gross_margin_rate)}，需要财务复核。`
    ],
    sourceLabels: ["经营指标", "销售商机", "风险信号", "运维事件", "来源引用"]
  };
}

function opsImpactSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const impact = toRecord(data.ops_impact) ?? data;
  const incident = toRecord(impact.incident) ?? {};
  const summary = toRecord(impact.impact_summary) ?? {};
  const rows = [
    { 项目: "影响订单", 内容: friendly(readArray(impact.affected_orders).map((item) => item.order_id)) },
    { 项目: "影响客户", 内容: friendly(readArray(impact.affected_customers).map((item) => item.customer_name)) },
    { 项目: "客户影响", 内容: friendly(summary.customer_impact) },
    { 项目: "回滚方案", 内容: friendly(impact.rollback_plan) },
    { 项目: "客户沟通草稿", 内容: friendly(impact.customer_message_draft) }
  ];
  return {
    kind: "ops_impact",
    title: "ECS GPU 运维事件经营影响",
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: "ECS GPU 运维事件经营影响",
      metrics: [
        metric("延期", summary.delay_hours, "小时"),
        metric("影响GMV", summary.impact_gmv_cny, "元"),
        metric("收入确认风险", summary.revenue_recognition_risk_cny, "元")
      ],
      tags: [
        tag("事件状态", friendly(incident.status ?? "处理中"), "warn"),
        tag("客户沟通", "需销售确认", "warn"),
        tag("回滚方案", "草稿", "info")
      ],
      charts: [
        {
          kind: "bar",
          title: "事件经营影响",
          xKey: "影响项",
          yKey: "金额",
          series: [
            { 影响项: "影响GMV", 金额: Number(summary.impact_gmv_cny ?? 0) },
            { 影响项: "收入确认风险", 金额: Number(summary.revenue_recognition_risk_cny ?? 0) }
          ]
        }
      ],
      rows,
      columns: columns(["项目", "内容"]),
      insights: [
        { title: "事件", summary: friendly(incident.title) },
        ...readStringArray(impact.next_actions).slice(0, 5).map((item, index) => ({ title: `处理动作 ${index + 1}`, summary: item })),
        { title: "数据边界", summary: friendly(impact.data_boundary) }
      ]
    },
    summaryLines: [
      `事件：${friendly(incident.title)}`,
      `延期：${formatNumber(summary.delay_hours)} 小时，影响 GMV ${formatCurrency(summary.impact_gmv_cny)}`,
      "对外沟通和回滚仅为草稿，需要销售、SRE 和法务确认。"
    ],
    sourceLabels: ["SLA/运维事件", "订单", "客户", "容量池", "来源引用"]
  };
}

function degradationPlanSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const plan = toRecord(data.degradation_plan) ?? data;
  const product = toRecord(plan.product) ?? {};
  const rows = [
    ...readStringArray(plan.product_page_degradation).map((item, index) => ({ 类型: "商品页降级", 序号: index + 1, 动作: item })),
    ...readStringArray(plan.sales_talk_degradation).map((item, index) => ({ 类型: "销售话术", 序号: index + 1, 动作: item })),
    ...readStringArray(plan.sre_alerts).map((item, index) => ({ 类型: "SRE 告警", 序号: index + 1, 动作: item })),
    ...readStringArray(plan.sales_notifications).map((item, index) => ({ 类型: "销售通知", 序号: index + 1, 动作: item })),
    ...readStringArray(plan.customer_support_notice).map((item, index) => ({ 类型: "客服通知", 序号: index + 1, 动作: item })),
    ...readStringArray(plan.rollback_checkpoints).map((item, index) => ({ 类型: "回滚检查点", 序号: index + 1, 动作: item }))
  ];
  return {
    kind: "degradation_plan",
    title: "云商品降级与通知方案",
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: "云商品降级与通知方案",
      metrics: [
        metric("触发条件", readStringArray(plan.trigger_conditions).length, "项"),
        metric("降级动作", rows.filter((row) => row.类型 === "商品页降级").length, "项"),
        metric("通知动作", rows.filter((row) => /通知|告警/.test(String(row.类型))).length, "项")
      ],
      tags: [
        tag("商品", friendly(product.product_name ?? "云商品"), "info"),
        tag("生产变更", plan.production_mutation === false ? "不自动执行" : "需复核", "warn"),
        tag("数据性质", "演示方案", "info")
      ],
      rows,
      columns: columns(["类型", "序号", "动作"]),
      insights: [
        ...readStringArray(plan.trigger_conditions).slice(0, 4).map((item, index) => ({ title: `触发条件 ${index + 1}`, summary: item })),
        { title: "数据边界", summary: friendly(plan.data_boundary) }
      ]
    },
    summaryLines: [
      `商品：${friendly(product.product_name ?? "云商品")}`,
      "包含商品页降级、销售话术、SRE 告警、销售通知、客服通知和回滚检查点。",
      "仅生成降级草稿，不自动变更生产配置。"
    ],
    sourceLabels: ["风险信号", "流程任务", "GTM 材料", "演示假设"]
  };
}

function overagePolicySurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const policy = toRecord(data.overage_policy) ?? data;
  const rows = [
    { 项目: "是否自动扣费", 内容: policy.auto_charge === true ? "会自动扣费" : "不会自动扣费" },
    { 项目: "确认人", 内容: friendly(policy.confirmation_owner) },
    ...readStringArray(policy.confirmation_steps).map((item, index) => ({ 项目: `确认流程 ${index + 1}`, 内容: item })),
    ...readStringArray(policy.bill_notice).map((item, index) => ({ 项目: `账单提示 ${index + 1}`, 内容: item })),
    ...readStringArray(policy.sales_boundary).map((item, index) => ({ 项目: `销售边界 ${index + 1}`, 内容: item }))
  ];
  return {
    kind: "overage_policy",
    title: "Agent Plan 超额付费说明",
    tool,
    viewComponent: "DataTableSurface",
    viewProps: {
      title: "Agent Plan 超额付费说明",
      description: "客户可见口径：额度用完后不自动扣费，需二次确认。",
      columns: columns(["项目", "内容"]),
      rows,
      rowCount: rows.length
    },
    summaryLines: [
      friendly(policy.conclusion ?? "额度用完后不自动扣费，需客户管理员二次确认。"),
      "正式开通前需要客户管理员确认超额单价、预算上限和账单提醒。"
    ],
    sourceLabels: ["回答策略样例", "用量估算器", "风险信号", "演示假设"]
  };
}

function retrospectiveTemplateSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const template = toRecord(data.retrospective_template) ?? data;
  const product = toRecord(template.product) ?? {};
  const rows = [
    ...readStringArray(template.product_launch_checklist).map((item, index) => ({ 模板: "商品上架检查", 序号: index + 1, 检查点: item })),
    ...readStringArray(template.customer_success_checklist).map((item, index) => ({ 模板: "客户成功检查", 序号: index + 1, 检查点: item }))
  ];
  return {
    kind: "retrospective_template",
    title: "云商品复盘模板",
    tool,
    viewComponent: "AnalyticsDashboardSurface",
    viewProps: {
      title: "云商品复盘模板",
      metrics: [
        metric("上架检查", readStringArray(template.product_launch_checklist).length, "项"),
        metric("客户成功检查", readStringArray(template.customer_success_checklist).length, "项"),
        metric("可复用检查点", readStringArray(template.reusable_checkpoints).length, "项")
      ],
      tags: readStringArray(template.reusable_checkpoints).slice(0, 8).map((item) => tag("Checkpoint", item, "info")),
      rows,
      columns: columns(["模板", "序号", "检查点"]),
      insights: [
        { title: "商品", summary: friendly(product.product_name ?? "云商品") },
        { title: "数据边界", summary: friendly(template.data_boundary) }
      ]
    },
    summaryLines: [
      `商品：${friendly(product.product_name ?? "云商品")}`,
      "已沉淀商品上架、客户成功、事故沟通和经营复盘检查点。",
      "复盘模板为演示草稿，不代表正式制度或生产变更。"
    ],
    sourceLabels: ["IPD 检查点", "风险信号", "流程任务", "GTM 材料", "演示假设"]
  };
}

function releaseRiskSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const report = toRecord(data.risk_report) ?? data;
  const risks = riskItems(readArray(report.risk_items), "发布风险");
  const blocking = readArray(report.blocking_tasks).map((item) => ({
    id: String(item.task_id ?? item.step ?? "task"),
    level: BLOCKED_STATUS.has(String(item.status)) ? "高" : "中",
    tool: "流程阻塞",
    message: `${friendly(item.task_name ?? item.step)}：${friendly(item.blocker_reason ?? item.status)}`,
    owner: friendly(item.owner ?? item.owner_user_id ?? item.owner_team),
    mitigated: false
  }));
  return {
    kind: "release_risk",
    title: "云商品发布风险审查",
    tool,
    viewComponent: "RiskListSurface",
    viewProps: {
      title: "云商品发布风险审查",
      risks: [...risks, ...blocking]
    },
    summaryLines: [
      `总体风险：${friendly(report.risk_level)}`,
      report.requires_human_review === true ? "需要人工复核后才能继续发布。" : "建议完成检查后继续。",
      `回滚检查点：${friendly(report.rollback_plan)}`
    ],
    sourceLabels: ["发布申请", "风险信号", "流程任务", "审批任务", "来源引用"]
  };
}

function approvalSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const summary = toRecord(data.approval_summary) ?? data;
  const rows = [
    { 项目: "发布标题", 内容: friendly(summary.title) },
    { 项目: "当前状态", 内容: friendly(summary.current_status) },
    { 项目: "风险等级", 内容: friendly(summary.risk_level) },
    { 项目: "建议决策", 内容: friendly(summary.recommended_decision) },
    { 项目: "人审要求", 内容: summary.human_review_required === true ? "需要人工复核" : "完成检查后可继续" },
    { 项目: "回滚检查点", 内容: friendly(summary.rollback_checkpoint) }
  ];
  return {
    kind: "approval",
    title: "云商品审批摘要",
    tool,
    viewComponent: "DataTableSurface",
    viewProps: {
      title: "云商品审批摘要",
      columns: columns(["项目", "内容"]),
      rows,
      rowCount: rows.length
    },
    summaryLines: rows.map((row) => `${row.项目}：${row.内容}`),
    sourceLabels: ["发布申请", "审批任务", "流程任务", "风险信号"]
  };
}

function closedLoopSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const plan = toRecord(data.closed_loop_plan) ?? data;
  const steps = readArray(plan.steps).map((item, index) => ({
    步骤: `${index + 1}. ${friendly(item.step)}`,
    负责人: friendly(item.owner),
    动作: friendly(item.action),
    状态: friendly(item.status)
  }));
  return {
    kind: "closed_loop",
    title: "云商品闭环模拟计划",
    tool,
    viewComponent: "DataTableSurface",
    viewProps: {
      title: "云商品闭环模拟计划",
      description: "仅生成模拟计划，不执行真实发布。",
      columns: columns(["步骤", "负责人", "动作", "状态"]),
      rows: steps,
      rowCount: steps.length
    },
    summaryLines: [
      `灰度范围：${friendly(plan.gray_scope)}`,
      plan.requires_human_review === true ? "需要人工复核。" : "完成检查后可推进。",
      "生产变更：不会自动执行真实生产变更。"
    ],
    sourceLabels: ["发布申请", "闭环模拟", "审批检查点"]
  };
}

function releaseDraftSurface(data: JsonObject, tool: string): CloudSurfaceData | null {
  const draft = toRecord(data.draft) ?? data;
  const audit = toRecord(data.audit) ?? {};
  const rows = [
    { 项目: "发布草稿", 内容: friendly(draft.title) },
    { 项目: "商品", 内容: friendly(draft.product_id) },
    { 项目: "变更类型", 内容: friendly(draft.change_type) },
    { 项目: "状态", 内容: friendly(draft.status) },
    { 项目: "回滚方案", 内容: friendly(draft.rollback_plan) },
    { 项目: "检查点", 内容: friendly(audit.checkpoint) }
  ];
  return {
    kind: "release_draft",
    title: "云商品发布草稿",
    tool,
    viewComponent: "DataTableSurface",
    viewProps: {
      title: "云商品发布草稿",
      description: "只生成草稿，不执行真实变更。",
      columns: columns(["项目", "内容"]),
      rows,
      rowCount: rows.length
    },
    summaryLines: rows.map((row) => `${row.项目}：${row.内容}`),
    sourceLabels: ["发布草稿", "人工确认检查点"]
  };
}

function cloudQuerySurface(result: JsonObject): CloudSurfaceData | null {
  const data = toRecord(result.data) ?? result;
  const labels = readDisplayLabels(data);
  const rawRows = (readArray(data.rows).length ? readArray(data.rows) : readArray(data.sample_rows)).slice(0, 12);
  if (!rawRows.length) return null;
  const resource = String(data.resource ?? result.resource ?? "cloud_query");
  const title = friendly(data.resource_label) !== "-" ? friendly(data.resource_label) : cloudResourceTitle(resource);
  if (resource === "cloud_risk_signals") {
    return {
      kind: "query",
      title,
      tool: "query_business_data",
      viewComponent: "RiskListSurface",
      viewProps: { title, risks: riskItems(rawRows, "风险信号") },
      summaryLines: [`共展示 ${rawRows.length} 条云商品风险信号。`],
      sourceLabels: [title]
    };
  }
  if (resource === "cloud_renewal_opportunities") {
    const renewalRows = rawRows.map((row) => ({
      客户: friendly(row.customer_name ?? row.customer_id),
      金额: formatCurrency(row.arr_at_risk_cny ?? row.current_arr_cny),
      续约概率: formatPercent(row.renewal_probability),
      风险等级: friendly(row.risk_level),
      负责人: friendly(row.owner ?? row.owner_user_id ?? row.owner_team),
      下一步: friendly(row.next_action ?? row.recommended_action ?? row.reasons)
    }));
    return {
      kind: "query",
      title,
      tool: "query_business_data",
      viewComponent: "DataTableSurface",
      viewProps: { title, columns: columns(["客户", "金额", "续约概率", "风险等级", "负责人", "下一步"]), rows: renewalRows, rowCount: renewalRows.length },
      summaryLines: [`共展示 ${renewalRows.length} 条续约风险记录。`],
      sourceLabels: [title]
    };
  }
  const rows = rawRows.map((row) => friendlyRow(row, labels));
  const isRisk = /workflow|approval/i.test(resource) || rows.some((row) => Object.values(row).some((value) => /风险|阻塞|延期|高/.test(String(value))));
  return {
    kind: "query",
    title,
    tool: "query_business_data",
    viewComponent: isRisk ? "RiskListSurface" : "DataTableSurface",
    viewProps: isRisk
      ? { title, risks: riskItems(rows, title) }
      : { title, columns: inferFriendlyColumns(rows), rows, rowCount: rows.length },
    summaryLines: [`共展示 ${rows.length} 条云商品业务记录。`],
    sourceLabels: [title]
  };
}

function buildCloudSurface(data: CloudSurfaceData, ctx: { surfacePrefix: string; runId: string }): SurfaceBuildOutput {
  const root = "cloud_openui_root";
  const surfaceId = `${ctx.surfacePrefix}_${ctx.runId}_cloud_${data.kind}`;
  const summaryIds = data.summaryLines.slice(0, 6).map((_line, index) => `cloud_openui_summary_${index}`);
  const sourceIds = data.sourceLabels.slice(0, 6).map((_line, index) => `cloud_openui_source_${index}`);
  const components: OpenUILangCompatComponentInstance[] = [
    text("cloud_openui_title", data.title),
    ...summaryIds.map((id, index) => text(id, data.summaryLines[index])),
    list("cloud_openui_summary", summaryIds),
    ...sourceIds.map((id, index) => text(id, `证据：${data.sourceLabels[index]}`)),
    list("cloud_openui_sources", sourceIds),
    card(root, ["cloud_openui_title", "cloud_openui_summary", "cloud_openui_sources"])
  ];
  return {
    surfaceId,
    root,
    data: {
      title: data.title,
      domain: "云商品平台",
      tool_label: toolLabel(data.tool),
      source_labels: data.sourceLabels,
      openui_lang: {
        protocol: "openui-lang/1.0",
        intent: data.kind,
        decision: {
          enabled: true,
          intent: data.kind,
          surfaceKind: "BusinessBriefSurface",
          source: "cloud_commodity_prompt_contract",
          confidence: "high",
          reason: "云商品工具结果按业务导读优先展示契约投影",
          detailSurfaceKind: data.viewComponent
        }
      },
      openui: openUIView("BusinessBriefSurface", businessBriefProps(data))
    },
    components
  };
}

function businessBriefProps(data: CloudSurfaceData): JsonObject {
  const evidence = data.sourceLabels.map(friendly).filter(Boolean).slice(0, 4).join(" / ");
  return {
    title: briefTitle(data),
    verdict: briefVerdict(data),
    tone: briefTone(data),
    subtitle: briefSubtitle(data),
    kpis: briefKpis(data),
    priority_items: briefPriorityItems(data),
    next_actions: briefNextActions(data),
    evidence_label: evidence || "业务数据 / 工具结果",
    boundary_label: briefBoundary(data),
    details: {
      component: data.viewComponent,
      props: data.viewProps
    }
  };
}

function briefTitle(data: CloudSurfaceData): string {
  if (data.kind === "executive" || data.kind === "gmv_target") return "业务结论";
  if (data.kind === "solution") return "方案导读";
  if (data.kind === "quote" || data.kind === "estimate") return "询价/估算导读";
  if (data.kind === "productization") return "产品化导读";
  if (data.kind === "offer_design") return "Offer 治理导读";
  if (data.kind === "entitlement_review") return "权益治理导读";
  if (data.kind === "channel_publication") return "渠道发布导读";
  if (data.kind === "master_data_impact") return "主数据治理导读";
  if (data.kind === "financial_review") return "财务商业化导读";
  if (data.kind === "customer_explanation") return "客户解释导读";
  if (data.kind === "change_impact") return "版本变更导读";
  if (data.kind === "post_launch_health") return "发布巡检导读";
  if (data.kind === "ipd_readiness" || data.kind === "product_model") return "上架导读";
  if (data.kind === "capacity_risk" || data.kind === "ops_impact" || data.kind === "sre_launch_gate") return "运维影响导读";
  if (data.kind === "approval" || data.kind === "release_risk" || data.kind === "release_draft") return "审批导读";
  return data.title || "业务导读";
}

function briefVerdict(data: CloudSurfaceData): string {
  const first = data.summaryLines.map(friendly).find((line) => line && line !== "-");
  if (first) return first;
  const insights = readArray(data.viewProps.insights);
  const conclusion = insights.find((item) => /结论|总体|状态/i.test(String(item.title ?? "")));
  return friendly(conclusion?.summary ?? data.title);
}

function briefSubtitle(data: CloudSurfaceData): string {
  const lines = data.summaryLines.map(friendly).filter((line) => line && line !== "-").slice(1, 3);
  if (lines.length) return lines.join("；");
  const tags = readArray(data.viewProps.tags)
    .slice(0, 3)
    .map((item) => [friendly(item.label), friendly(item.value)].filter((value) => value && value !== "-").join("："))
    .filter(Boolean);
  return tags.join("；");
}

function briefTone(data: CloudSurfaceData): string {
  const text = JSON.stringify({
    kind: data.kind,
    summary: data.summaryLines,
    tags: data.viewProps.tags,
    insights: data.viewProps.insights,
    rows: readArray(data.viewProps.rows).slice(0, 6)
  });
  if (/阻塞|blocked|延期|逾期/.test(text)) return "blocked";
  if (/高风险|风险|high|critical|不建议|不可承诺|不足|低毛利/.test(text)) return "danger";
  if (/待|需|审批|复核|草稿|关注|warn|medium/.test(text)) return "warn";
  return "good";
}

function briefKpis(data: CloudSurfaceData): JsonObject[] {
  const metrics = readArray(data.viewProps.metrics);
  if (metrics.length) return metrics.slice(0, 4).map((item) => ({
    label: friendly(item.label ?? item.key),
    value: friendly(item.value),
    unit: item.unit ? friendly(item.unit) : ""
  }));
  const tags = readArray(data.viewProps.tags);
  if (tags.length >= 2) {
    return tags.slice(0, 4).map((item) => ({
      label: friendly(item.label),
      value: friendly(item.value)
    }));
  }
  const rows = readArray(data.viewProps.rows);
  if (rows.length) {
    const important = rows.filter((row) => /必填|阻塞|风险|待|审批|复核|高|延期/.test(JSON.stringify(row))).length;
    return [
      { label: "展示项", value: rows.length, unit: "项" },
      { label: important ? "需关注" : "已梳理", value: important || rows.length, unit: "项" }
    ];
  }
  return tags.slice(0, 4).map((item) => ({
    label: friendly(item.label),
    value: friendly(item.value)
  }));
}

function briefPriorityItems(data: CloudSurfaceData): JsonObject[] {
  const risks = readArray(data.viewProps.risks);
  if (risks.length) {
    return risks.slice(0, 4).map((risk) => ({
      title: friendly(risk.message ?? risk.id ?? "风险项"),
      detail: friendly(risk.level ?? risk.tool),
      owner: friendly(risk.owner),
      impact: friendly(risk.impact),
      tone: "danger"
    }));
  }
  const rows = readArray(data.viewProps.rows);
  const riskRows = rows.filter((row) => /风险|阻塞|延期|逾期|不可承诺|低毛利|不足|审批/.test(JSON.stringify(row)));
  const selected = (riskRows.length ? riskRows : rows).slice(0, 4);
  return selected.map((row) => ({
    title: friendly(row.内容 ?? row.项目 ?? row.客户 ?? row.产品 ?? row.检查点 ?? row.阶段 ?? row.任务 ?? row.门禁 ?? row.渠道 ?? row.Offer ?? "重点事项"),
    detail: friendly(row.缺口 ?? row.阻塞 ?? row.状态 ?? row.组合理由 ?? row.内容 ?? row.说明),
    owner: friendly(row.负责人),
    impact: friendly(row.影响 ?? row.预算 ?? row.金额 ?? row.后续动作 ?? row.发布前检查 ?? row.缺失风险),
    tone: /风险|阻塞|延期|高|不足|不可/.test(JSON.stringify(row)) ? "danger" : "warn"
  }));
}

function briefNextActions(data: CloudSurfaceData): JsonObject[] {
  const insights = readArray(data.viewProps.insights);
  const actions = insights
    .filter((item) => /下一步|动作|处理|报价前|检查|回滚/.test(String(item.title ?? "")))
    .map((item) => ({
      title: friendly(item.title),
      detail: friendly(item.summary ?? item.recommendation),
      tone: "warn"
    }));
  const rows = readArray(data.viewProps.rows)
    .filter((row) => row.下一步 || row.动作)
    .map((row) => ({
      title: friendly(row.动作 ?? row.下一步),
      detail: friendly(row.客户 ?? row.产品 ?? row.阶段 ?? row.项目),
      owner: friendly(row.负责人),
      tone: "warn"
    }));
  const summaryActions = data.summaryLines
    .filter((line) => /下一步|请|需要|建议|复核|确认/.test(line))
    .map((line, index) => ({
      title: `行动 ${index + 1}`,
      detail: friendly(line),
      tone: "warn"
    }));
  const combined = [...actions, ...rows, ...summaryActions].filter((item) => item.title || item.detail);
  const deduped = dedupeBriefItems(combined).slice(0, 4);
  return deduped.length ? deduped : defaultBriefNextActions(data);
}

function defaultBriefNextActions(data: CloudSurfaceData): JsonObject[] {
  const defaults: Partial<Record<CloudSurfaceKind, string[]>> = {
    solution: ["确认地域容量、规格与交付窗口。", "提交合同折扣、资源包和财务审批。", "输出正式报价前检查清单，避免承诺库存、SLA 或固定交付日期。"],
    quote: ["确认合同价、资源包、地域和实际调用形态。", "提示用户这是估算结果，不是正式报价或固定产能承诺。"],
    estimate: ["复核估算公式、关键假设和边界。", "正式报价前确认合同、资源包和实际调用形态。"],
    product_model: ["请商品 PM 确认购买页字段和商品范围。", "请财务复核价格、折扣和资源包抵扣规则。", "请法务/SRE 确认 SLA、内容安全和不可承诺边界。"],
    productization: ["请商品 PM 补齐目标客户、客户价值和能力边界。", "请财务补齐成本测算输入和毛利底线。", "请 SRE/法务确认 SLA 初稿和不可承诺项。"],
    offer_design: ["拆清 Offer、SKU、计量项和价格规则关系。", "确认按量、包月、会员权益和超额付费互斥/叠加策略。", "价格、促销和合同折扣进入人工审批。"],
    entitlement_review: ["明确额度发放、消耗、过期、退订和退款规则。", "默认关闭自动扣费，超额付费必须客户二次确认。", "账单页和客服口径同步解释权益边界。"],
    channel_publication: ["以商品中台作为主数据源。", "逐渠道确认可展示字段和禁展示项。", "官网、控制台、销售报价和 API/Marketplace 人工确认后再发布。"],
    sre_launch_gate: ["补齐容量、限流、告警、灰度和回滚门禁。", "确认客服通知和销售同步口径。", "只生成巡检计划和审批摘要，人工确认后再放量。"],
    master_data_impact: ["确认主数据源和字段归属方。", "评估 SKU、价格、订购、合同、账单和渠道同步影响。", "高风险字段只生成变更草稿和审批摘要。"],
    financial_review: ["确认收入确认、成本归集和递延收入口径。", "检查折扣、促销、资源包和赠送权益是否无审批叠加。", "低于毛利底线时进入财务审批。"],
    customer_explanation: ["用客户能听懂的话解释额度、账单和正式报价边界。", "过滤内部成本、毛利底线和风控阈值。", "需要客服、销售、法务或财务确认后再对外使用。"],
    change_impact: ["识别影响客户、合同、账单、权益和渠道。", "保留上一版本快照和回滚计划。", "只生成变更影响评审，不直接生效。"],
    post_launch_health: ["巡检官网、控制台、销售报价一致性。", "校验订单、计量、账单闭环和客户反馈。", "生成发布健康日报和后续动作。"],
    release_draft: ["保持草稿状态，等待人工确认。", "补齐回滚方案和审批检查点。"],
    approval: ["按风险等级组织人工复核。", "确认回滚检查点后再进入生产流程。"],
    release_risk: ["先解除高风险和阻塞项。", "人工复核通过后再继续发布。"]
  };
  const items = defaults[data.kind] ?? ["明确负责人和截止时间。", "完成必要的人审或审批后再进入生产流程。"];
  return items.slice(0, 4).map((detail, index) => ({
    title: `动作 ${index + 1}`,
    detail,
    tone: "warn"
  }));
}

function briefBoundary(data: CloudSurfaceData): string {
  const insights = readArray(data.viewProps.insights);
  const boundary = insights.find((item) => /边界|数据说明|报价边界/i.test(String(item.title ?? "")));
  const text = friendly(boundary?.summary ?? data.summaryLines.find((line) => /demo|mock|演示|估算|非正式|草稿|承诺/.test(line)));
  if (text && text !== "-") return text;
  if (data.kind === "solution" || data.kind === "quote" || data.kind === "estimate") return "估算/方案为演示口径，正式报价需人工复核。";
  return "演示数据，仅用于业务链路验证。";
}

function dedupeBriefItems(items: JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.title, item.detail, item.owner, item.impact].map((value) => friendly(value)).join("|");
    if (!key.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function operatingMetrics(snapshot: JsonObject): JsonObject[] {
  return [
    metric("GMV", snapshot.gmv_cny ?? snapshot.gmv, "元"),
    metric("净收入", snapshot.net_revenue_cny ?? snapshot.net_revenue, "元"),
    metric("毛利率", snapshot.gross_margin_rate ?? snapshot.gross_margin_pct, ""),
    metric("活跃客户", snapshot.active_customers, "个"),
    metric("账单争议", snapshot.dispute_amount_cny ?? snapshot.bill_dispute_amount_cny, "元")
  ].filter((item) => item.value !== "-" && item.value !== undefined && item.value !== null);
}

function metric(label: string, value: unknown, unit = ""): JsonObject {
  return {
    key: safeKey(label),
    label,
    value: formatMetricDisplayValue(label, value, unit),
    unit
  };
}

function formatMetricDisplayValue(label: string, value: unknown, unit = ""): JsonValue {
  const n = Number(value);
  if (!unit && Number.isFinite(n) && n >= 0 && n <= 1 && /(率|占比|置信|健康|达成)/.test(label)) {
    return `${Math.round(n * 100)}%`;
  }
  return formatMetricValue(value);
}

function tag(label: string, value: unknown, tone = ""): JsonObject {
  return { label, value: friendly(value), tone };
}

function statusTone(value: unknown): string {
  const text = String(value ?? "").toLowerCase();
  if (/blocked|risk|high|critical|阻塞|风险|高|失败|不足/.test(text)) return "danger";
  if (/pending|review|waiting|medium|处理中|待|复核|审批|中/.test(text)) return "warn";
  if (/ready|completed|done|healthy|success|就绪|完成|健康|正常|已/.test(text)) return "good";
  return "info";
}

function countBy(rows: JsonObject[], key: string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = friendly(row[key] ?? "未分组");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()];
}

function currencyToNumber(value: unknown): number {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function percentToNumber(value: unknown): number {
  const text = String(value ?? "");
  const n = Number(text.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return text.includes("%") ? n : n * 100;
}

function riskItems(rows: JsonObject[], defaultTool: string): JsonObject[] {
  return rows.slice(0, 10).map((row, index) => ({
    id: String(row.risk_id ?? row.task_id ?? row.id ?? `risk_${index}`),
    level: friendly(row.severity ?? row.risk_level ?? row.warning_level ?? row.status ?? "中"),
    tool: friendly(row.risk_type ?? row.category ?? defaultTool),
    message: riskMessage(row),
    owner: friendly(row.owner ?? row.owner_team_label ?? row.owner_team ?? row.owner_user_id),
    impact: impactMessage(row),
    mitigated: /完成|已处理|低|正常|completed|done/i.test(String(row.status ?? row.risk_level ?? ""))
  }));
}

function riskMessage(row: JsonObject): string {
  return friendly(
    row.message
    ?? row.risk_name
    ?? row.title
    ?? row.blocker_reason
    ?? row.task_name
    ?? row.description
    ?? row.reason
    ?? Object.values(row).find((value) => typeof value === "string")
    ?? "需要关注的风险"
  );
}

function impactMessage(row: JsonObject): string {
  if (row.arr_at_risk_cny !== undefined) return `续约风险金额 ${formatCurrency(row.arr_at_risk_cny)}`;
  if (row.impact_amount_cny !== undefined) return `影响金额 ${formatCurrency(row.impact_amount_cny)}`;
  if (row.dispute_amount_cny !== undefined) return `账单争议 ${formatCurrency(row.dispute_amount_cny)}`;
  if (row.delay_hours !== undefined) return `已延期 ${formatNumber(row.delay_hours)} 小时`;
  if (row.impacted_customers !== undefined) return `影响客户 ${friendly(row.impacted_customers)}`;
  return "";
}

function readDisplayLabels(data: JsonObject): Record<string, string> {
  const labels: Record<string, string> = {};
  const displayLabels = toRecord(data.display_field_labels);
  if (displayLabels) {
    for (const [key, value] of Object.entries(displayLabels)) labels[key] = friendly(value);
  }
  for (const item of readArray(data.field_metadata)) {
    const record = toRecord(item);
    if (record?.key && record.label) labels[String(record.key)] = friendly(record.label);
  }
  return labels;
}

function friendlyRow(row: JsonObject, labels: Record<string, string> = {}): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(row)) {
    if (isHiddenKey(key)) continue;
    result[labels[key] ?? friendlyKey(key)] = friendly(value);
  }
  return result;
}

function inferFriendlyColumns(rows: JsonObject[]): JsonObject[] {
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) keys.push(key);
      if (keys.length >= 8) return columns(keys);
    }
  }
  return columns(keys);
}

function columns(keys: string[]): JsonObject[] {
  return keys.map((key) => ({ key, label: key, type: inferColumnType(key) }));
}

function inferColumnType(key: string): string {
  if (/金额|预算|价格|收入|GMV|争议/.test(key)) return "currency";
  if (/日期|时间|账期|创建/.test(key)) return "date";
  if (/状态|风险|等级|是否/.test(key)) return "status";
  if (/数量|轮数|秒数|小时|占比|置信度|毛利率/.test(key)) return "number";
  return "text";
}

function friendlyKey(key: string): string {
  const map: Record<string, string> = {
    customer_name: "客户",
    product_name: "商品",
    product_code: "商品代码",
    sku_name: "套餐",
    offer_name: "售卖方案",
    price_name: "价格项",
    status: "状态",
    risk_level: "风险等级",
    severity: "严重度",
    owner: "负责人",
    owner_team: "负责团队",
    owner_user_id: "负责人",
    amount_cny: "金额",
    budget_cny: "预算",
    arr_at_risk_cny: "续约风险金额",
    impact_amount_cny: "影响金额",
    delay_hours: "延期小时",
    blocker_reason: "阻塞原因",
    renewal_probability: "续约概率",
    current_status: "当前状态",
    recommended_decision: "建议决策",
    rollback_checkpoint: "回滚检查点",
    token_per_second: "每秒 token 消耗",
    retry_rate: "重试损耗",
    moderation_overhead_ratio: "内容安全审核损耗",
    safety_buffer_ratio: "安全缓冲",
    average_turn_total_tokens: "平均每轮 token",
    scenario_type: "对话形态",
    multimodal_multiplier: "多模态消耗系数",
    tool_afp_per_round: "每轮工具 AFP",
    caveat: "说明"
  };
  return map[key] ?? humanizeKey(key);
}

function friendly(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map(friendly).filter(Boolean).join("、");
  if (typeof value === "object") return summarizeObject(value);
  const raw = String(value);
  const map: Record<string, string> = {
    finance_reviewer_001: "财务复核负责人",
    legal_001: "法务审核负责人",
    sales_ai_001: "AI 内容客户销售负责人",
    sales_media_001: "媒体客户销售负责人",
    cloud_sales_001: "陆衡",
    cloud_sales_002: "金融行业销售负责人",
    cloud_pm_001: "程一川",
    cloud_exec_001: "沈澜",
    ai_business: "AI 商品经营团队",
    cloud_business: "云业务经营团队",
    finance: "财务团队",
    legal: "法务团队",
    sales: "销售团队",
    product: "商品产品团队",
    cloud_product: "商品产品团队",
    sre: "SRE 运维团队",
    sku_agent_plan_medium: "Agent Plan Medium 套餐",
    agent_with_search: "带搜索工具的智能体对话",
    text_only: "纯文本对话",
    image_understanding: "图像理解对话",
    video_generation: "视频生成对话",
    "720p_standard": "720p 标准档",
    "720p_high": "720p 高清档",
    "1080p_standard": "1080p 标准档",
    "1080p_high": "1080p 高清档",
    high: "高",
    medium: "中",
    low: "低",
    blocked: "已阻塞",
    in_progress: "处理中",
    completed: "已完成",
    ready: "就绪",
    waiting: "等待处理",
    needs_product_definition: "需要补齐产品定义",
    needs_entitlement_governance: "需要权益治理",
    blocked_by_capacity_and_margin: "被容量和毛利门禁阻塞",
    ready_with_warnings: "可发布但需提示风险",
    blocked_by_entitlement: "被权益规则阻塞",
    requires_finance_review: "需要财务复核",
    needs_sre_gate: "需要 SRE 门禁确认",
    manual_review_required: "需要人工复核",
    blocked_until_approval: "审批前阻塞",
    hold_for_review: "先暂停并复核",
    approve_after_checks: "检查完成后可审批",
    draft_only: "仅草稿",
    draft: "草稿",
    active: "生效中",
    pending: "待处理",
    mitigating: "处理中",
    in_review: "复核中",
    queued: "排队中",
    margin: "毛利风险",
    capacity: "容量风险",
    renewal: "续约风险",
    process_bottleneck: "流程阻塞",
    legal_sla: "法务/SLA 风险",
    sales_commitment: "销售承诺风险",
    compliance: "合规风险",
    usage_cost: "用量成本风险",
    queue_health: "队列健康风险",
    overage_policy: "超额付费规则",
    new_offer: "新增售卖方案",
    collect_evidence: "收集证据",
    batch_config_draft: "生成批量配置草稿",
    risk_review: "风险审查",
    approval_summary: "审批摘要",
    gray_release: "灰度发布",
    announcement: "公告与销售 FAQ",
    rollback_checkpoint: "回滚检查点",
    price_discount_guardrail: "价格与折扣护栏",
    traffic_ramp_limit: "流量灰度与限流策略"
  };
  return sanitizeVisibleText(map[raw] ?? raw);
}

function sanitizeVisibleText(value: string): string {
  return value
    .replace(/\bseverity\s*=\s*high\b/gi, "高严重度风险")
    .replace(/\bdelay_hours\s*>\s*0\b/gi, "已延期阻塞项")
    .replace(/\barr_at_risk_cny\b/g, "续约风险金额")
    .replace(/\bowner_user_id\b/g, "负责人")
    .replace(/\bowner_team\b/g, "负责团队")
    .replace(/\bmetric_id\b/g, "指标")
    .replace(/\bsource_type\b/g, "来源类型")
    .replace(/\bcloud_operating_metrics\b/g, "经营指标")
    .replace(/\bcloud_risk_signals\b/g, "风险信号")
    .replace(/\bcloud_workflow_tasks\b/g, "流程任务")
    .replace(/\bcloud_renewal_opportunities\b/g, "续约机会")
    .replace(/\bcloud_ipd_checkpoints\b/g, "IPD 检查点")
    .replace(/\bcloud_productization_reviews\b/g, "产品化定义评审")
    .replace(/\bcloud_gtm_assets\b/g, "GTM 材料")
    .replace(/\bcloud_entitlement_rules\b/g, "套餐权益规则")
    .replace(/\bcloud_channel_publication_matrix\b/g, "渠道发布矩阵")
    .replace(/\bcloud_sre_readiness_gates\b/g, "SRE 上架门禁")
    .replace(/\bcloud_master_data_lineage\b/g, "主数据血缘")
    .replace(/\bcloud_financial_commercial_policies\b/g, "财务商业化口径")
    .replace(/\bcloud_customer_explanation_playbooks\b/g, "客户解释话术")
    .replace(/\bcloud_product_change_versions\b/g, "商品版本变更")
    .replace(/\bcloud_post_launch_checks\b/g, "发布后巡检")
    .replace(/\bcloud_capacity_pools\b/g, "容量池")
    .replace(/\bcloud_sales_opportunities\b/g, "销售商机")
    .replace(/\bcloud_sla_incidents\b/g, "SLA/运维事件")
    .replace(/\bcloud_source_refs\b/g, "来源引用")
    .replace(/\bbudget\b/g, "预算")
    .replace(/\bnet_budget\b/g, "可用预算")
    .replace(/\bprice_per_1k_tokens\b/g, "千 token 价格")
    .replace(/\bstorage_cdn_cost\b/g, "存储和分发预估成本")
    .replace(/\bdiscount\b/g, "合同折扣")
    .replace(/\btoken_per_second\b/g, "每秒 token 消耗")
    .replace(/\beffective_ratio\b/g, "有效产出比例")
    .replace(/\bafp_quota\b/g, "AFP 套餐额度")
    .replace(/\bextra_budget\b/g, "追加预算")
    .replace(/\boverage_price\b/g, "超额单价")
    .replace(/\bavailable_afp\b/g, "可用 AFP 额度")
    .replace(/\bturn_afp\b/g, "每轮 AFP 消耗")
    .replace(/\bsafety_buffer\b/g, "安全缓冲")
    .replace(/\bretry\b/g, "重试损耗")
    .replace(/\bmoderation\b/g, "内容安全审核损耗")
    .replace(/\bsafety\b/g, "安全余量")
    .replace(/\bestimated_rounds\b/g, "预计对话轮数")
    .replace(/\bestimated_seconds\b/g, "预计视频秒数")
    .replace(/\bestimated_video_seconds\b/g, "预计视频秒数")
    .replace(/\bestimated_video_count\b/g, "预计视频条数")
    .replace(/\bsku_agent_plan_medium\b/g, "Agent Plan Medium 套餐");
}

function summarizeObject(value: unknown): string {
  const record = toRecord(value);
  if (!record) return friendly(value);
  return Object.entries(record)
    .filter(([key]) => !isHiddenKey(key))
    .slice(0, 5)
    .map(([key, item]) => `${friendlyKey(key)}：${friendly(item)}`)
    .join("；") || "-";
}

function isHiddenKey(key: string): boolean {
  return /(^_|source_ref_ids|source_refs|linked_entities|debug|raw|internal|tool_call|metadata)/i.test(key);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => friendly(item)).filter((item) => item && item !== "-");
}

function sourceLabels(value: JsonObject): string[] {
  const explicit = readStringArray(value.evidence_sources);
  if (explicit.length) return explicit.map(sourceName);
  return ["经营指标", "风险信号", "流程任务", "续约机会", "来源引用"];
}

function sourceName(value: unknown): string {
  const raw = String(value ?? "");
  const map: Record<string, string> = {
    cloud_products: "商品目录",
    cloud_offers: "售卖方案",
    cloud_skus: "套餐规格",
    cloud_specs: "规格字段",
    cloud_meters: "计量项",
    cloud_prices: "价格样本",
    cloud_risk_rules: "风险规则",
    cloud_operating_metrics: "经营指标",
    cloud_risk_signals: "风险信号",
    cloud_workflow_tasks: "流程任务",
    cloud_renewal_opportunities: "续约机会",
    cloud_ipd_checkpoints: "IPD 检查点",
    cloud_productization_reviews: "产品化定义评审",
    cloud_gtm_assets: "GTM 材料",
    cloud_entitlement_rules: "套餐权益规则",
    cloud_channel_publication_matrix: "渠道发布矩阵",
    cloud_sre_readiness_gates: "SRE 上架门禁",
    cloud_master_data_lineage: "主数据血缘",
    cloud_financial_commercial_policies: "财务商业化口径",
    cloud_customer_explanation_playbooks: "客户解释话术",
    cloud_product_change_versions: "商品版本变更",
    cloud_post_launch_checks: "发布后巡检",
    cloud_capacity_pools: "容量池",
    cloud_sales_opportunities: "销售商机",
    cloud_sla_incidents: "SLA/运维事件",
    cloud_accounts: "客户账户",
    cloud_order_items: "订单明细",
    cloud_metering_records: "用量计量记录",
    cloud_product_families: "产品族",
    cloud_metric_definitions: "指标定义",
    cloud_metric_snapshots: "指标快照",
    cloud_assumption_profiles: "估算假设口径",
    cloud_answer_playbooks: "回答策略样例",
    cloud_data_contracts: "数据回答契约",
    cloud_sample_agent_answers: "回答样例占位",
    cloud_source_refs: "来源引用"
  };
  return map[raw] ?? friendly(raw);
}

function cloudResourceTitle(resource: string): string {
  const map: Record<string, string> = {
    cloud_products: "云商品目录",
    cloud_offers: "云商品售卖方案",
    cloud_skus: "云商品套餐规格",
    cloud_specs: "云商品规格字段",
    cloud_meters: "云商品计量项",
    cloud_prices: "云商品价格样本",
    cloud_customers: "云商品客户",
    cloud_contracts: "云商品合同",
    cloud_bills: "云商品账单",
    cloud_invoices: "云商品发票",
    cloud_release_requests: "云商品发布申请",
    cloud_approval_tasks: "云商品审批任务",
    cloud_risk_signals: "云商品风险信号",
    cloud_workflow_tasks: "云商品流程任务",
    cloud_renewal_opportunities: "云商品续约机会",
    cloud_operating_metrics: "云商品经营指标",
    cloud_usage_estimators: "云商品估算器",
    cloud_ipd_checkpoints: "云商品 IPD 检查点",
    cloud_productization_reviews: "云产品化定义评审",
    cloud_gtm_assets: "云商品 GTM 材料",
    cloud_entitlement_rules: "云套餐权益规则",
    cloud_channel_publication_matrix: "云商品渠道发布矩阵",
    cloud_sre_readiness_gates: "云商品 SRE 上架门禁",
    cloud_master_data_lineage: "云主数据血缘",
    cloud_financial_commercial_policies: "云商品财务商业化口径",
    cloud_customer_explanation_playbooks: "云客户解释话术",
    cloud_product_change_versions: "云商品版本变更",
    cloud_post_launch_checks: "云商品发布后巡检",
    cloud_accounts: "云客户账户",
    cloud_order_items: "云订单明细",
    cloud_metering_records: "云用量计量记录",
    cloud_product_families: "云产品族",
    cloud_metric_definitions: "云经营指标定义",
    cloud_metric_snapshots: "云经营指标快照",
    cloud_risk_rules: "云风险规则",
    cloud_assumption_profiles: "云估算假设口径",
    cloud_answer_playbooks: "云回答策略样例",
    cloud_data_contracts: "云数据回答契约",
    cloud_sample_agent_answers: "云回答样例占位",
    cloud_source_refs: "云商品来源引用"
  };
  return map[resource] ?? "云商品业务数据";
}

function toolLabel(tool: string): string {
  const map: Record<string, string> = {
    estimate_agent_plan_rounds: "Agent Plan 轮数估算",
    estimate_seedance_video_seconds: "Seedance 视频秒数估算",
    cloud_product_model_draft: "云商品配置草稿",
    cloud_productization_readiness_review: "云产品化定义评审",
    cloud_offer_design_review: "云商品 Offer 治理评审",
    cloud_plan_entitlement_review: "云套餐权益治理评审",
    cloud_channel_publication_review: "云商品渠道发布评审",
    cloud_sre_launch_gate_review: "云商品 SRE 上架门禁",
    cloud_master_data_impact_review: "云主数据变更影响评审",
    cloud_financial_commercialization_review: "云商品财务商业化评审",
    cloud_customer_explanation: "云客户解释话术",
    cloud_product_change_impact_review: "云商品版本变更影响评审",
    cloud_post_launch_health_check: "云商品发布后巡检",
    cloud_executive_briefing: "云商品经营简报",
    cloud_solution_recommendation: "云商品方案推荐",
    cloud_self_service_quote: "云商品自助询价",
    cloud_ipd_readiness_review: "云商品 IPD 就绪评审",
    cloud_gtm_package_draft: "云商品 GTM 包草稿",
    cloud_capacity_risk_review: "云商品容量风险评审",
    cloud_gmv_target_briefing: "云商品 GMV 目标简报",
    cloud_ops_incident_business_impact: "云商品运维事件经营影响",
    cloud_ops_degradation_plan: "云商品降级与通知方案",
    cloud_agent_plan_overage_policy: "Agent Plan 超额付费说明",
    cloud_retrospective_template: "云商品复盘模板",
    cloud_release_risk_review: "云商品发布风险审查",
    create_cloud_release_draft: "云商品发布草稿",
    create_cloud_approval_summary: "云商品审批摘要",
    simulate_cloud_closed_loop: "云商品闭环模拟",
    query_business_data: "云商品数据查询"
  };
  return map[tool] ?? "云商品能力";
}

function formatCurrency(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n).toLocaleString("zh-CN")} 元`;
}

function formatNumber(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("zh-CN");
}

function formatPercent(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n * 100)}%`;
}

function formatMetricValue(value: unknown): JsonValue {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return friendly(value);
}

function formatConfidence(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "需要人工复核";
  return `${Math.round(n * 100)}%`;
}

function averageConfidence(a: unknown, b: unknown): number | string {
  const values = [Number(a), Number(b)].filter((value) => Number.isFinite(value));
  if (!values.length) return "需要人工复核";
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100;
}

function safeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "_").replace(/^_+|_+$/g, "") || "metric";
}

function humanizeKey(key: string): string {
  return key
    .replace(/^cloud_/, "")
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

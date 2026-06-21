import { loadJson } from "../../data/load-json.js";
import { getResourceDataPath } from "../runtime-registry.js";
import { defineTool, ToolResultBaseSchema, z } from "../../tools/zod-helpers.js";
import type { JsonObject, ToolDefinition } from "../../types/agent-contracts.js";

type Row = Record<string, unknown>;

const CLOUD = {
  products: "cloud_products",
  offers: "cloud_offers",
  skus: "cloud_skus",
  specs: "cloud_specs",
  meters: "cloud_meters",
  prices: "cloud_prices",
  contracts: "cloud_contracts",
  subscriptions: "cloud_subscriptions",
  customers: "cloud_customers",
  orders: "cloud_orders",
  bills: "cloud_bills",
  releaseRequests: "cloud_release_requests",
  approvalTasks: "cloud_approval_tasks",
  riskSignals: "cloud_risk_signals",
  workflowTasks: "cloud_workflow_tasks",
  renewalOpportunities: "cloud_renewal_opportunities",
  operatingMetrics: "cloud_operating_metrics",
  usageEstimators: "cloud_usage_estimators",
  ipdCheckpoints: "cloud_ipd_checkpoints",
  productizationReviews: "cloud_productization_reviews",
  gtmAssets: "cloud_gtm_assets",
  entitlementRules: "cloud_entitlement_rules",
  channelPublicationMatrix: "cloud_channel_publication_matrix",
  sreReadinessGates: "cloud_sre_readiness_gates",
  masterDataLineage: "cloud_master_data_lineage",
  financialCommercialPolicies: "cloud_financial_commercial_policies",
  customerExplanationPlaybooks: "cloud_customer_explanation_playbooks",
  productChangeVersions: "cloud_product_change_versions",
  postLaunchChecks: "cloud_post_launch_checks",
  capacityPools: "cloud_capacity_pools",
  salesOpportunities: "cloud_sales_opportunities",
  slaIncidents: "cloud_sla_incidents",
  sourceRefs: "cloud_source_refs",
};

export function createCloudCommodityTools(): ToolDefinition[] {
  return [
    estimateAgentPlanRoundsTool(),
    estimateSeedanceVideoSecondsTool(),
    cloudProductModelDraftTool(),
    cloudProductizationReadinessReviewTool(),
    cloudOfferDesignReviewTool(),
    cloudPlanEntitlementReviewTool(),
    cloudChannelPublicationReviewTool(),
    cloudSreLaunchGateReviewTool(),
    cloudMasterDataImpactReviewTool(),
    cloudFinancialCommercializationReviewTool(),
    cloudCustomerExplanationTool(),
    cloudProductChangeImpactReviewTool(),
    cloudPostLaunchHealthCheckTool(),
    cloudIpdReadinessReviewTool(),
    cloudGtmPackageDraftTool(),
    cloudCapacityRiskReviewTool(),
    cloudGmvTargetBriefingTool(),
    cloudOpsIncidentBusinessImpactTool(),
    cloudOpsDegradationPlanTool(),
    cloudAgentPlanOveragePolicyTool(),
    cloudRetrospectiveTemplateTool(),
    cloudExecutiveBriefingTool(),
    cloudSolutionRecommendationTool(),
    cloudSelfServiceQuoteTool(),
    cloudReleaseRiskReviewTool(),
    createCloudReleaseDraftTool(),
    createCloudApprovalSummaryTool(),
    simulateCloudClosedLoopTool(),
  ];
}

async function table<T extends Row = Row>(resource: string): Promise<T[]> {
  const path = getResourceDataPath(resource) ?? `data/cloud-commodity/${resource}.json`;
  return loadJson<T[]>(path);
}

function ok(tool: string, data: unknown) {
  return { ok: true, tool, data };
}

function fail(tool: string, error: string, message: string) {
  return { ok: false, tool, error, message };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function numberAt(row: Row | undefined, field: string, fallback: number): number {
  const value = Number(row?.[field] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const matched = typeof value === "string" ? value.match(/\d+(?:\.\d+)?/)?.[0] : value;
  const number = Number(matched ?? fallback);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const CLOUD_VALUE_LABELS: Record<string, string> = {
  finance_reviewer_001: "财务复核负责人",
  legal_001: "法务审核负责人",
  sales_ai_001: "AI 内容客户销售负责人",
  sales_media_001: "媒体客户销售负责人",
  cloud_sales_001: "陆衡",
  cloud_sales_002: "金融行业销售负责人",
  sre_seedance_001: "Seedance 运维负责人",
  sre_agent_001: "Agent Plan 运维负责人",
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
  model_pricing_review: "模型价格复核",
  content_safety_terms: "内容安全条款审核",
  afp_rule_finance_review: "AFP 计费规则财务复核",
  legal_terms_review: "法务条款审核",
  blocked: "已阻塞",
  in_progress: "处理中",
  completed: "已完成",
  high: "高",
  medium: "中",
  low: "低",
};

function readableCloudValue(value: unknown): string {
  const key = String(value ?? "");
  return CLOUD_VALUE_LABELS[key] ?? key;
}

function findProduct(products: Row[], needle: string): Row | undefined {
  const normalized = needle.trim().toLowerCase();
  return products.find((product) => {
    const values = [product.product_id, product.product_code, product.product_name].map((value) => String(value ?? "").toLowerCase());
    return values.some((value) => value === normalized || value.includes(normalized) || normalized.includes(value));
  });
}

function defaultReleaseIdForProduct(productId: string): string {
  if (productId === "prod_seedance") return "rel_seedance_mini_selfserve_202606";
  if (productId === "prod_agent_plan") return "rel_agent_plan_enterprise_202606";
  if (productId === "prod_ecs") return "rel_ecs_gpu_train_202606";
  return "";
}

function metricValueByIncludes(metrics: Row[], includes: string[], fallback: unknown = undefined): unknown {
  const row = metrics.find((item) => {
    const text = String(item.metric_name ?? item.metric_id ?? "").toLowerCase();
    return includes.every((part) => text.includes(part.toLowerCase()));
  });
  return row?.metric_value ?? fallback;
}

function findContractDiscount(contracts: Row[], customerId: string, productId: string): number | null {
  const contract = contracts.find((item) => item.customer_id === customerId);
  const policy = asObject(contract?.discount_policy);
  const value = Number(policy[productId]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sourceRefsFor(row: Row, refs: Row[]): Row[] {
  const ids = Array.isArray(row.source_ref_ids) ? row.source_ref_ids.map(String) : [];
  return refs.filter((ref) => ids.includes(String(ref.source_ref_id)));
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function draftProductName(args: { product_code?: string; product_name?: string; product_description?: string }): string {
  const text = String(args.product_description ?? "");
  return args.product_name
    ?? text.match(/(?:名字叫|名称叫|名叫|叫)\s*([A-Za-z0-9_\-\u4e00-\u9fa5]{2,40})/)?.[1]
    ?? text.match(/([A-Za-z][A-Za-z0-9_\-]{1,40})\s*(?:是一款|是一个|是款)/)?.[1]
    ?? args.product_code
    ?? "新模型商品";
}

function draftProductCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "NEW_MODEL_PRODUCT";
}

function buildNewProductDraft(args: { product_code?: string; product_name?: string; product_description?: string }): Row {
  const name = draftProductName(args);
  const code = args.product_code ?? draftProductCode(name);
  return {
    product_id: `draft_${code.toLowerCase()}`,
    product_code: code,
    product_name: name,
    product_category: "AI 模型商品",
    provider: "demo_provider",
    source_type: "demo_assumption",
    mocked: true,
    confidence: 0.62,
    description: args.product_description ?? "新模型商品建模草稿",
  };
}

function buildNewProductOffers(product: Row, description: unknown): Row[] {
  const productId = String(product.product_id);
  const text = String(description ?? "");
  const hasMemberGrant = /(会员|登录|登陆|赠送|50\s*RMB|50元|等值\s*token)/i.test(text);
  return [
    {
      offer_id: `${productId}_paygo_offer`,
      product_id: productId,
      offer_name: "按量 Token 计费",
      billing_mode: "按量",
      status: "draft",
      source_type: "demo_assumption",
      mocked: true,
    },
    ...(hasMemberGrant ? [{
      offer_id: `${productId}_member_grant_offer`,
      product_id: productId,
      offer_name: "会员每日赠送额度",
      billing_mode: "会员权益",
      status: "draft",
      source_type: "demo_assumption",
      mocked: true,
    }] : []),
  ];
}

function buildNewProductSkus(product: Row, description: unknown): Row[] {
  const productId = String(product.product_id);
  const text = String(description ?? "");
  const grantAmount = text.match(/(\d+(?:\.\d+)?)\s*(?:RMB|元)/i)?.[1] ?? "50";
  return [
    {
      sku_id: `${productId}_standard_token_sku`,
      product_id: productId,
      sku_name: "标准 Token 计费 SKU",
      billing_mode: "按量",
      status: "draft",
      source_type: "demo_assumption",
      mocked: true,
    },
    {
      sku_id: `${productId}_member_daily_grant_sku`,
      product_id: productId,
      sku_name: `会员每日 ${grantAmount} 元等值 Token 权益`,
      billing_mode: "会员权益",
      status: "draft",
      source_type: "demo_assumption",
      mocked: true,
    },
  ];
}

function buildNewProductSpecs(skus: Row[], description: unknown): Row[] {
  const text = String(description ?? "");
  return skus.flatMap((sku) => [
    {
      spec_id: `${sku.sku_id}_model`,
      sku_id: sku.sku_id,
      spec_key: "model_name",
      spec_name: "模型名称",
      required_for_purchase: true,
      source_type: "demo_assumption",
      mocked: true,
    },
    {
      spec_id: `${sku.sku_id}_token_unit`,
      sku_id: sku.sku_id,
      spec_key: "token_metering_unit",
      spec_name: "Token 计量单位",
      spec_unit: "1K tokens",
      required_for_purchase: true,
      source_type: "demo_assumption",
      mocked: true,
    },
    ...(/会员|赠送|登录|登陆/i.test(text) ? [{
      spec_id: `${sku.sku_id}_member_grant`,
      sku_id: sku.sku_id,
      spec_key: "member_daily_grant",
      spec_name: "会员每日赠送额度",
      spec_unit: "RMB 等值 Token",
      required_for_purchase: true,
      source_type: "demo_assumption",
      mocked: true,
    }] : []),
  ]);
}

function buildNewProductMeters(product: Row, description: unknown): Row[] {
  const productId = String(product.product_id);
  const text = String(description ?? "");
  return [
    {
      meter_id: `${productId}_input_tokens`,
      product_id: productId,
      meter_code: "input_tokens",
      meter_name: "输入 Token",
      meter_unit: "1K tokens",
      source_type: "demo_assumption",
      mocked: true,
    },
    {
      meter_id: `${productId}_output_tokens`,
      product_id: productId,
      meter_code: "output_tokens",
      meter_name: "输出 Token",
      meter_unit: "1K tokens",
      source_type: "demo_assumption",
      mocked: true,
    },
    ...(/会员|赠送|登录|登陆/i.test(text) ? [{
      meter_id: `${productId}_member_grant_consumed`,
      product_id: productId,
      meter_code: "member_grant_consumed",
      meter_name: "会员赠送额度消耗",
      meter_unit: "RMB 等值 Token",
      source_type: "demo_assumption",
      mocked: true,
    }] : []),
  ];
}

function buildNewProductPrices(product: Row, offers: Row[], description: unknown): Row[] {
  const productId = String(product.product_id);
  const text = String(description ?? "");
  const grantAmount = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:RMB|元)/i)?.[1] ?? 50);
  return offers.map((offer) => ({
    price_id: `${offer.offer_id}_draft_price`,
    product_id: productId,
    offer_id: offer.offer_id,
    price_name: String(offer.offer_name).includes("会员") ? "会员每日赠送额度估算" : "Token 按量单价待复核",
    billing_mode: offer.billing_mode,
    currency: "CNY",
    unit_price_cny: String(offer.offer_name).includes("会员") ? 0 : null,
    grant_value_cny: String(offer.offer_name).includes("会员") ? grantAmount : null,
    pricing_rule: String(offer.offer_name).includes("会员")
      ? "会员每日登录后发放等值 Token 权益；发放、过期、退订和超额规则待财务/法务复核。"
      : "按输入/输出 Token 计量；单价、阶梯、免费额度和抹零规则待财务复核。",
    source_type: "demo_assumption",
    mocked: true,
    confidence: 0.58,
  }));
}

function estimateAgentPlanRoundsTool(): ToolDefinition {
  return defineTool({
    name: "estimate_agent_plan_rounds",
    description: "估算 Agent Plan 在指定套餐、预算、对话形态下可支持多少轮对话。结果必须视为带假设的估算，不是销售承诺。",
    metadata: {
      required_permissions: ["cloud:estimate"],
      risk_level: "read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      package_id: z.string().max(80).nullable().optional(),
      extra_budget_cny: z.number().min(0).optional(),
      scenario_type: z.enum(["text_only", "agent_with_search", "image_understanding", "video_generation"]).nullable().optional(),
      average_turn_total_tokens: z.number().min(1).max(200000).nullable().optional(),
      web_search_calls_per_round: z.number().min(0).max(20).optional(),
      professional_dataset_calls_per_round: z.number().min(0).max(20).optional(),
      arkclaw_calls_per_round: z.number().min(0).max(20).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [skus, specs, prices, estimators] = await Promise.all([
        table(CLOUD.skus),
        table(CLOUD.specs),
        table(CLOUD.prices),
        table(CLOUD.usageEstimators),
      ]);
      const packageId = args.package_id ?? "agent_plan_medium";
      const skuNeedle = packageId.replace(/^agent_plan_/, "");
      const pkg = skus.find((item) => String(item.sku_id).includes(skuNeedle) && item.product_id === "prod_agent_plan")
        ?? skus.find((item) => item.sku_id === "sku_agent_plan_medium");
      if (!pkg) return fail("estimate_agent_plan_rounds", "package_not_found", "没有找到 Agent Plan 套餐。");

      const profile = estimators.find((item) => item.estimator_id === "est_agent_rounds_default" || item.estimator_type === "agent_rounds");
      const assumptions = asObject(profile?.assumptions);
      const multiplierByScenario = asObject(assumptions.multimodal_multiplier);
      const toolCosts = asObject(assumptions.tool_call_afp);
      const afpSpec = specs.find((item) => item.sku_id === pkg.sku_id && item.spec_key === "afp_quota");
      const afpQuota = Number(afpSpec?.spec_value ?? 500000);
      const overagePrice = numberAt(prices.find((item) => item.price_id === "pr_agent_afp_overage"), "unit_price", 0.012);
      const extraBudget = args.extra_budget_cny ?? 0;
      const averageTokens = args.average_turn_total_tokens ?? Number(assumptions.average_turn_total_tokens ?? 2000);
      const scenarioType = args.scenario_type ?? "agent_with_search";
      const multiplier = Number(multiplierByScenario[scenarioType] ?? 1.8);
      const toolAfp =
        (args.web_search_calls_per_round ?? 0.35) * Number(toolCosts.web_search_beta ?? 8) +
        (args.professional_dataset_calls_per_round ?? 0.05) * Number(toolCosts.professional_dataset ?? 15) +
        (args.arkclaw_calls_per_round ?? 0.1) * Number(toolCosts.arkclaw ?? 12);
      const availableAfp = afpQuota + Math.floor(extraBudget / Math.max(overagePrice, 0.0001));
      const safetyBuffer = Number(assumptions.safety_buffer_ratio ?? 0.15);
      const turnAfp = averageTokens / 1000 * Number(assumptions.afp_per_1k_text_tokens ?? 1) * multiplier + toolAfp;
      const estimatedRounds = Math.floor(availableAfp * (1 - safetyBuffer) / Math.max(turnAfp, 0.0001));

      return ok("estimate_agent_plan_rounds", {
        estimate: {
          estimated_rounds: estimatedRounds,
          effective_afp: Math.floor(availableAfp * (1 - safetyBuffer)),
          available_afp: availableAfp,
          estimated_afp_per_round: Number(turnAfp.toFixed(2)),
          recommended_plan: pkg.sku_id,
          unit: "rounds",
          formula: String(profile?.formula ?? "floor((afp_quota + floor(extra_budget / overage_price)) * (1 - safety_buffer) / turn_afp)"),
          assumptions: {
            average_turn_total_tokens: averageTokens,
            scenario_type: scenarioType,
            multimodal_multiplier: multiplier,
            tool_afp_per_round: Number(toolAfp.toFixed(2)),
            safety_buffer_ratio: safetyBuffer,
            caveat: profile?.caveat,
          },
          confidence: 0.72,
          boundary: "估算不是承诺，真实轮数受上下文长度、工具调用、模型选择、缓存命中与安全策略影响。",
          evidence_refs: [String(pkg.sku_id), String(profile?.estimator_id ?? "est_agent_rounds_default"), "pr_agent_afp_overage"],
        },
      });
    },
  });
}

function estimateSeedanceVideoSecondsTool(): ToolDefinition {
  return defineTool({
    name: "estimate_seedance_video_seconds",
    description: "估算指定预算可生成多少秒 Seedance 视频，并折算目标时长视频条数。结果必须带假设、边界和置信度。",
    metadata: {
      required_permissions: ["cloud:estimate"],
      risk_level: "read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      budget_cny: z.number().min(1).optional(),
      quality: z.enum(["720p_standard", "720p_high", "1080p_standard", "1080p_high"]).nullable().optional(),
      video_input: z.boolean().optional(),
      target_duration_seconds: z.union([z.number().min(1).max(120), z.string().max(20)]).nullable().optional(),
      customer_id: z.string().max(80).nullable().optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [prices, estimators, contracts] = await Promise.all([
        table(CLOUD.prices),
        table(CLOUD.usageEstimators),
        table(CLOUD.contracts),
      ]);
      const budget = args.budget_cny ?? 10000;
      const quality = args.quality ?? "720p_standard";
      const videoInput = args.video_input ?? false;
      const duration = normalizePositiveNumber(args.target_duration_seconds, 5);
      const priceId = videoInput ? "pr_seedance_video_input" : quality.includes("high") ? "pr_seedance_token_pro" : "pr_seedance_token_lite";
      const price = numberAt(prices.find((item) => item.price_id === priceId), "unit_price", 0.023);
      const profile = estimators.find((item) => item.estimator_id === "est_seedance_video_seconds");
      const assumptions = asObject(profile?.assumptions);
      const tokensPerSecondByQuality = asObject(assumptions.token_per_second_by_quality);
      const tokensPerSecond = Number(tokensPerSecondByQuality[quality] ?? 4200);
      const customerId = args.customer_id ?? "cust_ai_studio";
      const discount = findContractDiscount(contracts, customerId, "prod_seedance") ?? 1;
      const retryRate = Number(assumptions.retry_rate ?? 0.08);
      const moderation = Number(assumptions.moderation_overhead_ratio ?? 0.03);
      const safety = Number(assumptions.safety_buffer_ratio ?? 0.12);
      const storageCdnCost = Math.min(budget * 0.06, quality.startsWith("1080p") ? 1200 : 600);
      const netBudget = Math.max(0, budget - storageCdnCost) * discount;
      const tokenBudget1k = netBudget / Math.max(price, 0.0001);
      const grossSeconds = tokenBudget1k * 1000 / Math.max(tokensPerSecond, 1);
      const effectiveSeconds = Math.floor(grossSeconds * Math.max(0, 1 - retryRate - moderation - safety));

      return ok("estimate_seedance_video_seconds", {
        estimate: {
          estimated_video_seconds: effectiveSeconds,
          estimated_video_count: Math.floor(effectiveSeconds / duration),
          quality,
          budget_cny: budget,
          net_budget_cny: Number(netBudget.toFixed(2)),
          unit_price_per_1k_tokens: price,
          contract_discount: discount,
          storage_cdn_cost_estimate_cny: storageCdnCost,
          formula: String(profile?.formula ?? "floor(net_budget / price_per_1k_tokens * 1000 / token_per_second * effective_ratio)"),
          assumptions: {
            token_per_second: tokensPerSecond,
            retry_rate: retryRate,
            moderation_overhead_ratio: moderation,
            safety_buffer_ratio: safety,
            caveat: profile?.caveat,
          },
          confidence: 0.7,
          boundary: "估算不是固定产能承诺，真实结果受质量档位、视频输入、重试、审核、存储/CDN 与合同折扣影响。",
          evidence_refs: [priceId, String(profile?.estimator_id ?? "est_seedance_video_seconds"), customerId],
        },
      });
    },
  });
}

function cloudProductModelDraftTool(): ToolDefinition {
  return defineTool({
    name: "cloud_product_model_draft",
    description: "根据产品代码或产品名称生成云商品 Product/Offer/SKU/Meter/Price/购买页字段草稿。",
    metadata: {
      required_permissions: ["cloud:draft"],
      risk_level: "draft",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
      product_name: z.string().max(120).optional(),
      product_description: z.string().max(2000).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, offers, skus, specs, meters, prices, refs] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.offers),
        table(CLOUD.skus),
        table(CLOUD.specs),
        table(CLOUD.meters),
        table(CLOUD.prices),
        table(CLOUD.sourceRefs),
      ]);
      const needle = args.product_code ?? args.product_name ?? args.product_description ?? "SEEDANCE";
      const product = findProduct(products, needle) ?? buildNewProductDraft(args);
      const isNewProduct = !products.some((item) => item.product_id === product.product_id);
      const productOffers = isNewProduct ? buildNewProductOffers(product, args.product_description) : offers.filter((item) => item.product_id === product.product_id);
      const productSkus = isNewProduct ? buildNewProductSkus(product, args.product_description) : skus.filter((item) => item.product_id === product.product_id);
      const skuIds = new Set(productSkus.map((item) => item.sku_id));
      const productSpecs = isNewProduct ? buildNewProductSpecs(productSkus, args.product_description) : specs.filter((item) => skuIds.has(item.sku_id));
      const productMeters = isNewProduct ? buildNewProductMeters(product, args.product_description) : meters.filter((item) => item.product_id === product.product_id);
      const offerIds = new Set(productOffers.map((item) => item.offer_id));
      const productPrices = isNewProduct ? buildNewProductPrices(product, productOffers, args.product_description) : prices.filter((item) => offerIds.has(item.offer_id));
      const purchaseFields = buildPurchaseFields(product, productSpecs, productMeters);
      return ok("cloud_product_model_draft", {
        draft: {
          product,
          offers: productOffers,
          skus: productSkus,
          meters: productMeters,
          prices: productPrices,
          purchase_page_fields: purchaseFields,
          missing_fields: isNewProduct ? [
            "模型成本底线复核",
            "Token 计量与抹零规则",
            "会员赠送额度发放/过期/退订规则",
            "价格、合同折扣和促销互斥规则",
            "内容安全、SLA 和不可承诺边界",
          ] : inferMissingFields(product, productPrices, productMeters),
          review_notes: [
            isNewProduct ? "这是新商品建模草稿，不会写入生产商品目录；需要人工确认后再进入上架流程。" : "这是已有商品配置草稿。",
            "价格、合同折扣、资源包抵扣和内容安全规则必须经过人工复核。",
            "source_ref_ids 只表示证据来源；mocked/demo_assumption 不能作为官方承诺。",
          ],
          source_refs: isNewProduct ? [] : sourceRefsFor(product, refs),
          production_mutation: false,
          data_boundary: isNewProduct
            ? "新商品建模结果为 demo/草稿，不代表正式价格、正式库存、SLA 或已完成上架。"
            : "商品建模结果来自 demo 主数据和来源引用，不代表生产变更。",
        },
      });
    },
  });
}

function cloudProductizationReadinessReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_productization_readiness_review",
    description: "评审一个产品能力是否具备产品化条件，输出产品定义交付物、能力边界、成本输入、SLA 初稿、负责人和后续动作。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
      product_name: z.string().max(120).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, reviews, refs] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.productizationReviews),
        table(CLOUD.sourceRefs),
      ]);
      const product = findProduct(products, args.product_code ?? args.product_name ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      const review = reviews.find((item) => item.product_id === product?.product_id)
        ?? reviews.find((item) => String(item.product_name ?? "").includes(String(args.product_name ?? "")));
      if (!product || !review) return fail("cloud_productization_readiness_review", "review_not_found", "没有找到产品化定义评审样本。");
      const deliverables = readRows(review.deliverables).map((item) => ({
        ...item,
        status_label: readableCloudValue(item.status),
      }) as Row);
      const blockers = deliverables.filter((item) => item.status === "blocked" || item.status === "in_progress");
      return ok("cloud_productization_readiness_review", {
        productization_review: {
          product,
          review,
          readiness_score: review.readiness_score,
          overall_status: readableCloudValue(review.overall_status),
          target_customers: readStrings(review.target_customers),
          value_proposition: review.value_proposition,
          deliverables,
          blockers,
          boundary_items: readStrings(review.boundary_items),
          cost_inputs: readStrings(review.cost_inputs),
          sla_draft: review.sla_draft,
          next_actions: Array.from(new Set([
            ...blockers.map((item) => String(item.next_action ?? "")).filter(Boolean),
            "产品化定义只生成草稿；目标客户、成本输入、SLA 和不可承诺项必须人工确认后才能进入商品上架。",
          ])),
          production_mutation: false,
          evidence_sources: ["产品化定义评审", "产品主数据", "来源引用"],
          data_boundary: "产品化评审为 demo/mock 演示数据，用于说明产品定义流程，不代表任何云厂商正式上架结论。",
          source_refs: sourceRefsFor(review, refs),
        },
      });
    },
  });
}

function cloudOfferDesignReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_offer_design_review",
    description: "评审云商品 Offer/SKU/Meter/Price 设计，说明售卖方式关系、冲突点、折扣/促销/资源包互斥和后续动作。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, offers, skus, meters, prices, entitlementRules] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.offers),
        table(CLOUD.skus),
        table(CLOUD.meters),
        table(CLOUD.prices),
        table(CLOUD.entitlementRules),
      ]);
      const product = findProduct(products, args.product_code ?? "AGENT_PLAN") ?? products.find((item) => item.product_id === "prod_agent_plan");
      if (!product) return fail("cloud_offer_design_review", "product_not_found", "没有找到可评审的云商品。");
      const productId = String(product.product_id);
      const productOffers = offers.filter((item) => item.product_id === productId);
      const productSkus = skus.filter((item) => item.product_id === productId);
      const productMeters = meters.filter((item) => item.product_id === productId);
      const offerIds = new Set(productOffers.map((item) => item.offer_id));
      const skuIds = new Set(productSkus.map((item) => item.sku_id));
      const productPrices = prices.filter((item) => offerIds.has(item.offer_id) || skuIds.has(item.sku_id));
      const rules = entitlementRules.filter((item) => item.product_id === productId);
      const relationRows = productOffers.map((offer) => {
        const offerSkus = productSkus.filter((sku) => sku.offer_id === offer.offer_id);
        const offerPrices = productPrices.filter((price) => price.offer_id === offer.offer_id || offerSkus.some((sku) => sku.sku_id === price.sku_id));
        return {
          offer_name: offer.offer_name,
          billing_mode: offer.billing_mode,
          purchase_mode: offer.purchase_mode,
          skus: offerSkus.map((sku) => sku.sku_name).filter(Boolean),
          meters: productMeters.map((meter) => meter.meter_name).filter(Boolean),
          prices: offerPrices.map((price) => `${readableCloudValue(price.price_type)} ${price.unit_price ?? "-"} ${price.currency ?? ""}`.trim()),
        };
      });
      const conflicts = [
        ...(productId === "prod_agent_plan" ? [
          "按量、包月、会员权益和超额付费可以同时存在，但必须拆成不同 Offer 或权益规则，不能在同一购买动作里无感叠加。",
          "每日赠送额度、套餐额度、加购资源包和超额付费必须有明确消耗顺序。",
          "销售不能把 AFP 额度承诺为固定对话轮数。",
        ] : []),
        ...rules.filter((rule) => rule.risk_level === "high").map((rule) => `${rule.entitlement_name} 需要二次确认和财务/法务复核。`),
        "促销价、资源包和合同折扣必须互斥或经过审批，不能自动叠加。",
      ];
      return ok("cloud_offer_design_review", {
        offer_design_review: {
          product,
          offers: productOffers,
          skus: productSkus,
          meters: productMeters,
          prices: productPrices,
          entitlement_rules: rules,
          relation_rows: relationRows,
          conflicts,
          next_actions: [
            "把按量、包月、资源包、会员权益和超额付费拆成清晰 Offer 与权益规则。",
            "财务确认折扣、促销和资源包互斥策略后，只生成报价草稿或审批摘要。",
            "控制台和销售报价必须展示客户二次确认要求，不能默认开启超额扣费。",
          ],
          production_mutation: false,
          evidence_sources: ["Offer", "SKU", "计费项", "价格规则", "套餐权益规则"],
          data_boundary: "Offer 设计评审为 demo/mock 样本，不代表正式价格或生产配置。",
        },
      });
    },
  });
}

function cloudPlanEntitlementReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_plan_entitlement_review",
    description: "评审 Plan 型商品权益，输出额度发放、消耗顺序、过期、退订、退款、超额付费、二次确认和账单解释。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
      entitlement_name: z.string().max(160).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, rules, refs] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.entitlementRules),
        table(CLOUD.sourceRefs),
      ]);
      const product = findProduct(products, args.product_code ?? "AGENT_PLAN") ?? products.find((item) => item.product_id === "prod_agent_plan");
      if (!product) return fail("cloud_plan_entitlement_review", "product_not_found", "没有找到 Plan 型商品。");
      const productRules = rules.filter((item) => item.product_id === product.product_id)
        .filter((item) => !args.entitlement_name || String(item.entitlement_name ?? "").includes(args.entitlement_name));
      return ok("cloud_plan_entitlement_review", {
        entitlement_review: {
          product,
          rules: productRules,
          risk_items: productRules.flatMap((rule) => [
            ...(rule.confirmation_required ? [`${rule.entitlement_name} 必须客户二次确认后才能生效。`] : []),
            ...(rule.risk_level === "high" ? [`${rule.entitlement_name} 存在高风险，需要财务、法务或客户成功复核。`] : []),
          ]),
          next_actions: [
            "在购买页和账单页分开展示套餐额度、赠送额度、加购资源包和超额状态。",
            "默认关闭自动扣费；客户确认预算上限、单价和通知人后，只生成超额付费开通草稿。",
            "退款、退订和过期规则进入人工复核，避免客户把赠送权益理解为现金承诺。",
          ],
          production_mutation: false,
          evidence_sources: ["套餐权益规则", "产品主数据", "来源引用"],
          data_boundary: "权益治理为 demo/mock 演示规则，不代表正式合同条款或自动生效配置。",
          source_refs: productRules.flatMap((rule) => sourceRefsFor(rule, refs)),
        },
      });
    },
  });
}

function cloudChannelPublicationReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_channel_publication_review",
    description: "评审云商品发布到官网、控制台、销售报价、API/Marketplace 时，各渠道应该展示哪些字段、哪些不能展示以及来源口径。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, matrix, refs] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.channelPublicationMatrix),
        table(CLOUD.sourceRefs),
      ]);
      const product = findProduct(products, args.product_code ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      if (!product) return fail("cloud_channel_publication_review", "product_not_found", "没有找到可评审的云商品。");
      const rows = matrix.filter((item) => item.product_id === product.product_id);
      return ok("cloud_channel_publication_review", {
        channel_publication_review: {
          product,
          channels: rows,
          blocked_channels: rows.filter((item) => String(item.publication_status ?? "").includes("blocked") || String(item.publication_status ?? "").includes("requires") || String(item.publication_status ?? "").includes("needs")),
          next_actions: [
            "确认商品中台是主数据源；官网、控制台、销售报价和 API/Marketplace 都只是发布渠道。",
            "先补齐控制台权益规则、销售折扣审批和 API/SRE 门禁，再进入生产发布。",
            "所有渠道都要展示演示估算、非正式报价和不可承诺边界。",
          ],
          production_mutation: false,
          evidence_sources: ["渠道发布矩阵", "产品主数据", "来源引用"],
          data_boundary: "渠道发布矩阵为 demo/mock 演示数据，不代表真实官网、控制台或 Marketplace 发布状态。",
          source_refs: rows.flatMap((row) => sourceRefsFor(row, refs)),
        },
      });
    },
  });
}

function cloudSreLaunchGateReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_sre_launch_gate_review",
    description: "评审云商品上架前的 SRE 稳定性门禁，覆盖容量、限流、告警、灰度、回滚、SLA、客服通知和销售同步。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
      release_request_id: z.string().max(120).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, gates, refs] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.sreReadinessGates),
        table(CLOUD.sourceRefs),
      ]);
      const product = findProduct(products, args.product_code ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      if (!product) return fail("cloud_sre_launch_gate_review", "product_not_found", "没有找到可评审的云商品。");
      const releaseId = args.release_request_id ?? defaultReleaseIdForProduct(String(product.product_id));
      const relatedGates = gates.filter((item) => item.product_id === product.product_id && (!releaseId || item.release_request_id === releaseId));
      const blockers = relatedGates.filter((item) => item.status === "blocked" || item.status === "in_progress");
      return ok("cloud_sre_launch_gate_review", {
        sre_launch_gate_review: {
          product,
          release_request_id: releaseId,
          gates: relatedGates.map((gate) => ({ ...gate, status_label: readableCloudValue(gate.status) })),
          blockers,
          next_actions: Array.from(new Set([
            ...blockers.map((gate) => String(gate.next_action ?? "")).filter(Boolean),
            "SRE 门禁只生成巡检计划和审批摘要，不直接放量或改变生产限流策略。",
          ])),
          production_mutation: false,
          evidence_sources: ["SRE 上架门禁", "产品主数据", "来源引用"],
          data_boundary: "SRE 门禁为 demo/mock 演示数据，不代表真实生产容量、限流阈值或 SLA 承诺。",
          source_refs: relatedGates.flatMap((gate) => sourceRefsFor(gate, refs)),
        },
      });
    },
  });
}

function cloudMasterDataImpactReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_master_data_impact_review",
    description: "评审云商品主数据字段归属、下游消费系统和字段变更影响，输出血缘、影响对象、必做检查和人工确认边界。",
    metadata: { required_permissions: ["cloud:read", "cloud:risk"], risk_level: "sensitive_read", requires_confirmation: false, expose_to_agentic: true, intents: ["data_query", "mixed"] },
    inputSchema: z.object({ product_code: z.string().max(80).optional(), field_name: z.string().max(120).optional() }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, lineage, contracts, subscriptions, bills] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.masterDataLineage),
        table(CLOUD.contracts),
        table(CLOUD.subscriptions),
        table(CLOUD.bills),
      ]);
      const product = findProduct(products, args.product_code ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      if (!product) return fail("cloud_master_data_impact_review", "product_not_found", "没有找到云商品。");
      const productId = String(product.product_id);
      const rows = lineage.filter((item) => item.product_id === productId && (!args.field_name || String(item.field_name ?? "").includes(args.field_name) || String(item.business_label ?? "").includes(args.field_name)));
      const productSubs = subscriptions.filter((item) => item.offer_id || item.sku_id).slice(0, 5);
      const productContracts = contracts.slice(0, 5);
      const productBills = bills.slice(0, 5);
      return ok("cloud_master_data_impact_review", {
        master_data_impact: {
          product,
          lineage: rows,
          impacted_objects: {
            subscriptions: productSubs,
            contracts: productContracts,
            bills: productBills,
          },
          downstream_systems: Array.from(new Set(rows.flatMap((row) => readStrings(row.downstream_systems)))),
          required_checks: Array.from(new Set(rows.flatMap((row) => readStrings(row.required_checks)))),
          next_actions: [
            "确认商品中台是主数据源，官网、控制台、销售报价、订购和账单只消费已审批字段。",
            "字段变更前生成影响分析和审批摘要，覆盖 SKU、价格、订购、合同、账单和渠道同步。",
            "高风险字段不直接生效，只生成草稿/审批摘要并等待人工确认。",
          ],
          production_mutation: false,
          evidence_sources: ["主数据血缘", "订购关系", "合同", "账单"],
          data_boundary: "主数据血缘为 demo/mock 演示数据，不代表真实云厂商系统依赖。",
        },
      });
    },
  });
}

function cloudFinancialCommercializationReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_financial_commercialization_review",
    description: "评审云商品财务商业化口径，覆盖收入确认、免费额度成本、资源包递延、折扣叠加、毛利底线和审批触发条件。",
    metadata: { required_permissions: ["cloud:read", "cloud:risk"], risk_level: "sensitive_read", requires_confirmation: false, expose_to_agentic: true, intents: ["data_query", "mixed"] },
    inputSchema: z.object({ product_code: z.string().max(80).optional() }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, policies, metrics, rules] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.financialCommercialPolicies),
        table(CLOUD.operatingMetrics),
        table(CLOUD.entitlementRules),
      ]);
      const product = findProduct(products, args.product_code ?? "AGENT_PLAN") ?? products.find((item) => item.product_id === "prod_agent_plan");
      if (!product) return fail("cloud_financial_commercialization_review", "product_not_found", "没有找到云商品。");
      const productId = String(product.product_id);
      const productPolicies = policies.filter((item) => item.product_id === productId);
      const productMetrics = metrics.filter((item) => item.product_id === productId);
      const marginMetric = productMetrics.find((item) => /margin|毛利/i.test(String(item.metric_name ?? "")));
      const policy = productPolicies[0];
      const margin = Number(marginMetric?.metric_value);
      const floor = Number(policy?.gross_margin_floor);
      return ok("cloud_financial_commercialization_review", {
        financial_review: {
          product,
          policies: productPolicies,
          entitlement_rules: rules.filter((item) => item.product_id === productId),
          margin_snapshot: { current_margin_rate: Number.isFinite(margin) ? margin : null, gross_margin_floor: Number.isFinite(floor) ? floor : null },
          risk_items: [
            ...(Number.isFinite(margin) && Number.isFinite(floor) && margin < floor ? ["当前毛利率低于毛利底线，需要财务审批。"] : []),
            ...productPolicies.flatMap((item) => readStrings(item.approval_required_when)),
          ],
          next_actions: [
            "明确按量、包月、资源包、赠送权益和超额付费的收入确认口径。",
            "免费额度和高成本模型调用计入成本归集，避免套餐毛利被打穿。",
            "促销、合同折扣、资源包和赠送权益不得无审批叠加。",
          ],
          production_mutation: false,
          evidence_sources: ["财务商业化口径", "经营指标", "套餐权益规则"],
          data_boundary: "财务商业化口径为 demo/mock 演示数据，不代表正式会计政策或合同条款。",
        },
      });
    },
  });
}

function cloudCustomerExplanationTool(): ToolDefinition {
  return defineTool({
    name: "cloud_customer_explanation",
    description: "生成客户买前/买后友好解释，覆盖超额付费、账单高于估算、非正式报价、客户可见字段和必须披露边界。",
    metadata: { required_permissions: ["cloud:read"], risk_level: "read", requires_confirmation: false, expose_to_agentic: true, intents: ["data_query", "mixed"] },
    inputSchema: z.object({ product_code: z.string().max(80).optional(), scenario: z.string().max(160).optional() }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, playbooks] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.customerExplanationPlaybooks),
      ]);
      const product = findProduct(products, args.product_code ?? "AGENT_PLAN") ?? products.find((item) => item.product_id === "prod_agent_plan");
      if (!product) return fail("cloud_customer_explanation", "product_not_found", "没有找到云商品。");
      const productId = String(product.product_id);
      const rows = playbooks.filter((item) => item.product_id === productId)
        .filter((item) => !args.scenario || JSON.stringify(item).includes(args.scenario));
      return ok("cloud_customer_explanation", {
        customer_explanation: {
          product,
          playbooks: rows.length ? rows : playbooks.filter((item) => item.product_id === productId),
          visible_fields: Array.from(new Set(rows.flatMap((row) => readStrings(row.visible_fields)))),
          hidden_fields: Array.from(new Set(rows.flatMap((row) => readStrings(row.hidden_fields)))),
          must_disclose: Array.from(new Set(rows.flatMap((row) => readStrings(row.must_disclose)))),
          next_actions: rows.map((row) => String(row.next_action ?? "")).filter(Boolean),
          production_mutation: false,
          evidence_sources: ["客户解释话术", "商品主数据"],
          data_boundary: "客户解释为 demo/mock 话术草稿，正式对外口径需客服、销售、法务或财务确认。",
        },
      });
    },
  });
}

function cloudProductChangeImpactReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_product_change_impact_review",
    description: "评审已有云商品变更影响，覆盖版本、SKU/权益/价格调整、存量客户、合同兼容性、渠道同步和回滚。",
    metadata: { required_permissions: ["cloud:read", "cloud:risk", "cloud:draft"], risk_level: "draft", requires_confirmation: false, expose_to_agentic: true, intents: ["data_query", "mixed"] },
    inputSchema: z.object({ product_code: z.string().max(80).optional(), change_id: z.string().max(120).optional() }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, changes, customers] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.productChangeVersions),
        table(CLOUD.customers),
      ]);
      const product = findProduct(products, args.product_code ?? "AGENT_PLAN") ?? products.find((item) => item.product_id === "prod_agent_plan");
      if (!product) return fail("cloud_product_change_impact_review", "product_not_found", "没有找到云商品。");
      const productId = String(product.product_id);
      const rows = changes.filter((item) => (!args.change_id || item.change_id === args.change_id) && item.product_id === productId);
      const customerById = new Map(customers.map((customer) => [String(customer.customer_id), customer]));
      return ok("cloud_product_change_impact_review", {
        change_impact_review: {
          product,
          changes: rows.map((row) => ({
            ...row,
            affected_customer_names: readStrings(row.affected_customers).map((id) => customerById.get(id)?.customer_name ?? id),
          })),
          next_actions: [
            "生成变更影响分析，覆盖存量客户、合同兼容性、账单口径和渠道同步。",
            "价格、权益、SKU 或 SLA 变更只生成草稿/审批摘要，不直接生效。",
            "保留上一版本配置快照，并定义灰度范围和回滚触发条件。",
          ],
          production_mutation: false,
          evidence_sources: ["商品版本变更", "客户", "合同", "渠道发布矩阵"],
          data_boundary: "商品变更影响为 demo/mock 演示数据，不代表真实生产变更。",
        },
      });
    },
  });
}

function cloudPostLaunchHealthCheckTool(): ToolDefinition {
  return defineTool({
    name: "cloud_post_launch_health_check",
    description: "生成云商品发布后巡检，覆盖渠道一致性、订单/计量/账单闭环、客户反馈、负责人和后续动作。",
    metadata: { required_permissions: ["cloud:read", "cloud:risk"], risk_level: "sensitive_read", requires_confirmation: false, expose_to_agentic: true, intents: ["data_query", "mixed"] },
    inputSchema: z.object({ product_code: z.string().max(80).optional(), release_request_id: z.string().max(120).optional() }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, checks] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.postLaunchChecks),
      ]);
      const product = findProduct(products, args.product_code ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      if (!product) return fail("cloud_post_launch_health_check", "product_not_found", "没有找到云商品。");
      const productId = String(product.product_id);
      const releaseId = args.release_request_id ?? defaultReleaseIdForProduct(productId);
      const rows = checks.filter((item) => item.product_id === productId && (!releaseId || item.release_request_id === releaseId));
      return ok("cloud_post_launch_health_check", {
        post_launch_health: {
          product,
          release_request_id: releaseId,
          checks: rows,
          blockers: rows.filter((item) => item.status === "blocked" || item.status === "warning"),
          next_actions: Array.from(new Set(rows.map((item) => String(item.next_action ?? "")).filter(Boolean))),
          production_mutation: false,
          evidence_sources: ["发布后巡检", "渠道发布矩阵", "订单", "计量", "账单"],
          data_boundary: "发布后巡检为 demo/mock 演示数据，不代表真实生产巡检结果。",
        },
      });
    },
  });
}

function cloudExecutiveBriefingTool(): ToolDefinition {
  return defineTool({
    name: "cloud_executive_briefing",
    description: "生成老板视角云商品经营简报，汇总风险、流程阻塞、续约风险、责任人、影响客户/金额和下一步动作。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      focus: z.string().max(120).optional(),
      max_items: z.number().min(1).max(10).nullable().optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [risks, tasks, renewals, metrics, customers, refs] = await Promise.all([
        table(CLOUD.riskSignals),
        table(CLOUD.workflowTasks),
        table(CLOUD.renewalOpportunities),
        table(CLOUD.operatingMetrics),
        table(CLOUD.customers),
        table(CLOUD.sourceRefs),
      ]);
      const maxItems = args.max_items ?? 5;
      const customerById = new Map(customers.map((customer) => [String(customer.customer_id), customer]));
      const rankedRisks = risks
        .slice()
        .sort((a, b) => riskScore(b) - riskScore(a))
        .slice(0, maxItems)
        .map((risk): Row => ({
          ...risk,
          owner: readableCloudValue(risk.owner ?? risk.owner_team ?? risk.owner_user_id),
          owner_team_label: readableCloudValue(risk.owner_team),
          impacted_customers: customerNamesFromLinkedEntities(risk, customerById),
          source_refs: sourceRefsFor(risk, refs),
        }));
      const blockingTasks = tasks
        .filter((task) => task.status === "blocked" || Number(task.delay_hours ?? 0) > 0)
        .sort((a, b) => Number(b.delay_hours ?? 0) - Number(a.delay_hours ?? 0))
        .slice(0, maxItems)
        .map((task): Row => ({
          ...task,
          task_name: readableCloudValue(task.task_name ?? task.step ?? task.task_id),
          owner: readableCloudValue(task.owner ?? task.owner_user_id ?? task.owner_team),
          owner_team_label: readableCloudValue(task.owner_team),
          status_label: readableCloudValue(task.status),
        }));
      const renewalRisks = renewals
        .filter((item) => ["high", "medium"].includes(String(item.risk_level ?? "")))
        .sort((a, b) => renewalAmountAtRisk(b) - renewalAmountAtRisk(a))
        .slice(0, maxItems)
        .map((item): Row => ({
          ...item,
          customer_name: String(customerById.get(String(item.customer_id))?.customer_name ?? item.customer_id ?? ""),
          arr_at_risk_cny: renewalAmountAtRisk(item),
          owner: readableCloudValue(item.owner ?? item.owner_user_id),
        }));
      const amountAtRisk = renewalRisks.reduce((sum, item) => sum + Number(item.arr_at_risk_cny ?? 0), 0);
      const operatingSnapshot = buildOperatingSnapshot(metrics);
      const owners = Array.from(new Set([
        ...rankedRisks.map((risk) => String(risk.owner ?? "")).filter(Boolean),
        ...blockingTasks.map((task) => String(task.owner ?? "")).filter(Boolean),
        ...renewalRisks.map((item) => String(item.owner ?? "")).filter(Boolean),
        ...metrics.map((item) => readableCloudValue(item.owner_team)).filter(Boolean),
      ]));
      return ok("cloud_executive_briefing", {
        executive_briefing: {
          conclusion: rankedRisks.some((risk) => risk.severity === "high")
            ? "当前应优先处理高风险发布与客户续约敞口，暂不建议无人工复核直接放量。"
            : "当前没有高危信号，但仍需跟踪阻塞任务和续约窗口。",
          focus: args.focus ?? "risk_workflow_renewal",
          operating_snapshot: operatingSnapshot,
          data_boundary: "GMV、净收入、毛利率、活跃客户和账单争议金额均为 demo/mock 经营样本，只能用于演示和链路验证，不能表达为云厂商官方披露或正式承诺。",
          amount_at_risk_cny: amountAtRisk,
          top_risks: rankedRisks,
          blocking_tasks: blockingTasks,
          renewal_risks: renewalRisks,
          owners,
          next_actions: [
            "请财务团队今天内复核毛利率、账单争议和续约风险金额，判断是否暂停低毛利促销自动生效。",
            "请财务复核负责人优先解除已延期的发布阻塞项，并给出明确截止时间。",
            "请销售团队优先跟进续约风险金额较高的客户，生成客户沟通和合同复核清单。",
            "请商品产品团队把价格、发布和促销动作收敛为草稿或审批摘要，人工确认后再进入生产流程。",
          ],
          evidence_sources: ["经营指标", "风险信号", "流程任务", "续约机会", "来源引用"],
        },
      });
    },
  });
}

function cloudIpdReadinessReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_ipd_readiness_review",
    description: "评审云产品从 IPD 产品化到商品上架的准备度，输出检查点、缺口、负责人、下一步和人审边界。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
      release_request_id: z.string().max(120).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, releases, checkpoints, tasks, risks, refs] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.releaseRequests),
        table(CLOUD.ipdCheckpoints),
        table(CLOUD.workflowTasks),
        table(CLOUD.riskSignals),
        table(CLOUD.sourceRefs),
      ]);
      const product = findProduct(products, args.product_code ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      const release = releases.find((item) => item.release_request_id === args.release_request_id)
        ?? releases.find((item) => item.product_id === product?.product_id && String(item.release_request_id) === defaultReleaseIdForProduct(String(product?.product_id ?? "")))
        ?? releases.find((item) => item.product_id === product?.product_id);
      if (!product || !release) return fail("cloud_ipd_readiness_review", "release_not_found", "没有找到可评审的云商品发布申请。");
      const productId = String(product.product_id);
      const releaseId = String(release.release_request_id);
      const relatedCheckpoints = checkpoints.filter((item) => item.product_id === productId || item.release_request_id === releaseId);
      const relatedTasks = tasks.filter((item) => item.linked_release_request_id === releaseId);
      const relatedRisks = risks.filter((item) => {
        const linked = asObject(item.linked_entities);
        return linked.product_id === productId || linked.release_request_id === releaseId;
      });
      const blockers = relatedCheckpoints.filter((item) => item.status === "blocked" || item.status === "in_progress");
      return ok("cloud_ipd_readiness_review", {
        ipd_readiness: {
          product,
          release_request: release,
          readiness_score: Math.max(0, Math.round((relatedCheckpoints.length - blockers.length) / Math.max(relatedCheckpoints.length, 1) * 100)),
          overall_status: blockers.some((item) => item.status === "blocked") ? "blocked" : "in_progress",
          checkpoints: relatedCheckpoints.map((item) => ({
            ...item,
            owner: readableCloudValue(item.owner_user_id ?? item.owner_team),
            owner_team_label: readableCloudValue(item.owner_team),
            status_label: readableCloudValue(item.status),
          })),
          blockers,
          workflow_tasks: relatedTasks,
          risks: relatedRisks,
          next_actions: Array.from(new Set([
            ...relatedCheckpoints.map((item) => String(item.next_action ?? "")).filter(Boolean),
            "所有价格、容量、SLA 和上架动作只生成草稿/审批摘要，人工确认后才能进入生产流程。",
          ])),
          evidence_sources: ["IPD 检查点", "发布申请", "流程任务", "风险信号", "来源引用"],
          data_boundary: "IPD 检查点为 demo/mock 演示数据，不代表任何云厂商正式流程、价格或库存承诺。",
          source_refs: sourceRefsFor(release, refs),
        },
      });
    },
  });
}

function cloudGtmPackageDraftTool(): ToolDefinition {
  return defineTool({
    name: "cloud_gtm_package_draft",
    description: "生成云商品 GTM 包草稿，包含目标客户、卖点、FAQ、销售话术、不可承诺项和正式报价前检查清单。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:draft"],
      risk_level: "draft",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
      industry: z.string().max(120).optional(),
      customer_segment: z.string().max(120).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, assets, opportunities, capacityPools] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.gtmAssets),
        table(CLOUD.salesOpportunities),
        table(CLOUD.capacityPools),
      ]);
      const product = findProduct(products, args.product_code ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      if (!product) return fail("cloud_gtm_package_draft", "product_not_found", "没有找到云商品。");
      const productId = String(product.product_id);
      const relatedAssets = assets.filter((item) => item.product_id === productId);
      const relatedOpps = opportunities.filter((item) => Array.isArray(item.product_ids) && item.product_ids.includes(productId));
      const capacityWarnings = capacityPools.filter((item) => item.product_id === productId && ["risk", "watch"].includes(String(item.health_status ?? "")));
      return ok("cloud_gtm_package_draft", {
        gtm_package: {
          product,
          industry: args.industry ?? (productId === "prod_ecs" ? "AI 训练客户 / 金融核心系统客户" : productId === "prod_agent_plan" ? "开发者 / 企业研发 / 客户成功团队" : "电商 / 营销 / UGC 内容客户"),
          customer_segment: args.customer_segment ?? (productId === "prod_agent_plan" ? "开发者与企业协作客户" : productId === "prod_seedance" ? "内容生产与营销客户" : "大客户与高价值行业客户"),
          assets: relatedAssets,
          target_customers: relatedOpps.map((item) => ({
            customer_name: item.customer_name,
            industry: item.industry,
            budget_cny: item.budget_cny,
            stage: item.stage,
            requirements: item.requirements,
            blockers: item.blockers,
          })),
          sales_talk_track: relatedAssets.flatMap((item) => Array.isArray(item.content) ? item.content.map(String) : []).slice(0, 10),
          not_to_commit: Array.from(new Set(relatedAssets.flatMap((item) => Array.isArray(item.not_to_commit) ? item.not_to_commit.map(String) : []))),
          quote_checklist: productId === "prod_ecs" ? [
            "确认地域、GPU 规格、训练窗口和容量预约结果。",
            "确认折扣是否触发财务审批，不能直接给销售承诺。",
            "确认 SLA 文案、合同边界和不可承诺项。",
            "确认 RDS、TOS、CLB 等配套产品是否纳入同一报价口径。",
          ] : productId === "prod_agent_plan" ? [
            "确认套餐、AFP 额度、工具调用、联网搜索和多模态比例。",
            "确认超额付费是否需要客户二次确认，不能自动开通。",
            "确认企业协作权限、API Key、日志留存和管理员边界。",
            "确认轮数估算、用量恢复和账单解释不能被表达为保底承诺。",
          ] : [
            "确认分辨率、时长、参考素材、日生成量和内容安全要求。",
            "确认促销价、资源包和合同折扣是否互斥，不能直接承诺低毛利价格。",
            "确认大促并发、排队、失败补偿和客服通知预案。",
            "确认自助询价只是预算沟通，正式报价前必须人工复核。",
          ],
          capacity_warnings: capacityWarnings,
          confidence: 0.72,
          boundary: "GTM 包是演示草稿，不是正式价格、库存或 SLA 承诺。",
          evidence_sources: ["GTM 材料", "销售商机", "容量池", "演示假设"],
        },
      });
    },
  });
}

function cloudCapacityRiskReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_capacity_risk_review",
    description: "评审云商品地域容量、灰度范围和销售限售策略，适用于 ECS GPU 等容量敏感商品。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
      region_id: z.string().max(80).optional(),
      release_request_id: z.string().max(120).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, capacityPools, risks, tasks] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.capacityPools),
        table(CLOUD.riskSignals),
        table(CLOUD.workflowTasks),
      ]);
      const product = findProduct(products, args.product_code ?? "ECS") ?? products.find((item) => item.product_id === "prod_ecs");
      if (!product) return fail("cloud_capacity_risk_review", "product_not_found", "没有找到 ECS 商品。");
      const productId = String(product.product_id);
      const pools = capacityPools.filter((item) => item.product_id === productId && (!args.region_id || item.region_id === args.region_id));
      const relatedRisks = risks.filter((item) => {
        const linked = asObject(item.linked_entities);
        return linked.product_id === productId && (item.risk_type === "capacity" || linked.region_id || !args.release_request_id || linked.release_request_id === args.release_request_id);
      });
      const relatedTasks = tasks.filter((item) => !args.release_request_id || item.linked_release_request_id === args.release_request_id);
      return ok("cloud_capacity_risk_review", {
        capacity_review: {
          product,
          release_request_id: args.release_request_id ?? "rel_ecs_gpu_train_202606",
          overall_status: pools.some((item) => item.health_status === "risk") ? "risk" : "watch",
          capacity_pools: pools,
          risks: relatedRisks,
          workflow_blockers: relatedTasks.filter((item) => item.owner_team === "sre" || Number(item.delay_hours ?? 0) > 0),
          sales_restrictions: [
            "华东 1 可灰度开放，但大客户仍需容量预约。",
            "新加坡只支持容量预约，扩容完成前不得承诺固定交付日期。",
            "合同与购买页必须标注地域容量边界和人工确认要求。",
          ],
          next_actions: Array.from(new Set(pools.map((item) => String(item.next_action ?? "")).filter(Boolean))),
          confidence: 0.73,
          boundary: "容量数据为 demo/mock 样本，不能表达为真实库存或交付承诺。",
          evidence_sources: ["容量池", "风险信号", "流程任务", "来源引用"],
        },
      });
    },
  });
}

function cloudGmvTargetBriefingTool(): ToolDefinition {
  return defineTool({
    name: "cloud_gmv_target_briefing",
    description: "生成单个云商品的 GMV 目标、达成差距、pipeline、毛利、交付、容量和客户风险经营驾驶舱。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
      period: z.string().max(20).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, metrics, risks, opportunities, incidents] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.operatingMetrics),
        table(CLOUD.riskSignals),
        table(CLOUD.salesOpportunities),
        table(CLOUD.slaIncidents),
      ]);
      const product = findProduct(products, args.product_code ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      if (!product) return fail("cloud_gmv_target_briefing", "product_not_found", "没有找到云商品。");
      const productId = String(product.product_id);
      const period = args.period ?? "2026-06";
      const productMetrics = metrics.filter((item) => item.product_id === productId && item.period === period);
      const target = Number(metricValueByIncludes(productMetrics, ["GMV", "Target"], 0));
      const booked = Number(metricValueByIncludes(productMetrics, ["GMV", "Booked"], productMetrics.find((item) => /Revenue/i.test(String(item.metric_name ?? "")) && !/Net/i.test(String(item.metric_name ?? "")))?.metric_value ?? 0));
      const pipeline = Number(metricValueByIncludes(productMetrics, ["Pipeline"], 0));
      const gap = Math.max(0, target - booked);
      const relatedRisks = risks.filter((item) => asObject(item.linked_entities).product_id === productId);
      const relatedOpps = opportunities.filter((item) => Array.isArray(item.product_ids) && item.product_ids.includes(productId));
      const relatedIncidents = incidents.filter((item) => item.product_id === productId);
      return ok("cloud_gmv_target_briefing", {
        gmv_briefing: {
          product,
          period,
          target_cny: target,
          booked_cny: booked,
          weighted_pipeline_cny: pipeline,
          target_attainment_rate: target > 0 ? Number((booked / target).toFixed(4)) : null,
          gap_to_target_cny: gap,
          coverage_after_pipeline_cny: booked + pipeline,
          net_revenue_cny: metricValueByIncludes(productMetrics, ["Net", "Revenue"], 0),
          gross_margin_rate: metricValueByIncludes(productMetrics, ["Margin", "Rate"], metricValueByIncludes(productMetrics, ["Gross", "Margin"], null)),
          delayed_orders: metricValueByIncludes(productMetrics, ["Delayed", "Orders"], 0),
          capacity_health: metricValueByIncludes(productMetrics, ["Capacity", "Health"], metricValueByIncludes(productMetrics, ["Queue", "Health"], null)),
          usage_alerts: metricValueByIncludes(productMetrics, ["Usage", "Alerts"], null),
          metrics: productMetrics,
          top_risks: relatedRisks.sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 6).map((risk) => ({ ...risk, owner: readableCloudValue(risk.owner_team) })),
          cost_risk_items: productId === "prod_agent_plan"
            ? [
              "高成本模型调用会显著拉高单轮 AFP 消耗，需要限制默认模型档位和审批高消耗场景。",
              "联网搜索和外部工具调用会增加工具 AFP、检索成本和延迟，需要按客户场景开关。",
              "视频生成、多模态理解等能力不能默认打包成无限量，应设置额度、告警和客户二次确认。",
            ]
            : relatedRisks
              .filter((risk) => /毛利|成本|折扣|促销|用量/i.test(String(risk.title ?? risk.risk_name ?? risk.message ?? "")))
              .slice(0, 3)
              .map((risk) => String(risk.title ?? risk.risk_name ?? risk.message)),
          opportunities: relatedOpps,
          incidents: relatedIncidents,
          next_actions: [
            "财务复核折扣、资源包、超额付费或促销规则，避免 GMV 达成但毛利不健康。",
            "SRE/运营给出容量、队列、用量告警或交付限制口径。",
            "销售将高价值商机纳入正式报价前检查、合同折扣审批和客户沟通流程。",
            "老板视角按 GMV、pipeline、净收入、毛利和交付/用量风险同步看目标达成。",
          ],
          data_boundary: "GMV、pipeline、净收入、毛利、容量和用量健康度均为 demo/mock 经营样本，不能表达为官方披露或正式承诺。",
          evidence_sources: ["经营指标", "销售商机", "风险信号", "运维事件", "来源引用"],
        },
      });
    },
  });
}

function cloudOpsIncidentBusinessImpactTool(): ToolDefinition {
  return defineTool({
    name: "cloud_ops_incident_business_impact",
    description: "把云商品运维/SLA 事件翻译为订单、GMV、收入确认、客户沟通、回滚和下一步动作。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["data_query", "mixed"],
    },
    inputSchema: z.object({
      incident_id: z.string().max(120).optional(),
      product_code: z.string().max(80).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, incidents, orders, customers, capacityPools] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.slaIncidents),
        table(CLOUD.orders),
        table(CLOUD.customers),
        table(CLOUD.capacityPools),
      ]);
      const product = findProduct(products, args.product_code ?? "ECS") ?? products.find((item) => item.product_id === "prod_ecs");
      const incident = incidents.find((item) => item.incident_id === args.incident_id)
        ?? incidents.find((item) => item.product_id === product?.product_id);
      if (!incident) return fail("cloud_ops_incident_business_impact", "incident_not_found", "没有找到 ECS GPU 运维事件。");
      const affectedOrderIds = Array.isArray(incident.affected_order_ids) ? incident.affected_order_ids.map(String) : [];
      const affectedCustomerIds = Array.isArray(incident.affected_customer_ids) ? incident.affected_customer_ids.map(String) : [];
      const affectedOrders = orders.filter((item) => affectedOrderIds.includes(String(item.order_id)));
      const affectedCustomers = customers.filter((item) => affectedCustomerIds.includes(String(item.customer_id)));
      const relatedCapacity = capacityPools.filter((item) => item.product_id === incident.product_id && item.region_id === incident.region_id);
      return ok("cloud_ops_incident_business_impact", {
        ops_impact: {
          incident,
          product,
          affected_orders: affectedOrders,
          affected_customers: affectedCustomers,
          related_capacity: relatedCapacity,
          impact_summary: {
            delay_hours: incident.delay_hours,
            impact_gmv_cny: incident.impact_gmv_cny,
            revenue_recognition_risk_cny: incident.revenue_recognition_risk_cny,
            customer_impact: incident.customer_impact,
          },
          customer_message_draft: [
            "当前新加坡 GPU 资源进入容量保护状态，我们会优先保障已确认订单交付。",
            "正式交付窗口以 SRE 扩容结果和合同确认信息为准；如接受华东 1 替代地域，可提前启动交付。",
            "本说明为事件沟通草稿，最终对外口径需销售、SRE 和法务确认。",
          ],
          rollback_plan: incident.rollback_plan,
          next_actions: Array.isArray(incident.mitigation_steps) ? incident.mitigation_steps : [],
          production_mutation: false,
          data_boundary: "运维事件、影响金额和交付延期均为 demo/mock 样本，不代表真实生产事件。",
          evidence_sources: ["SLA/运维事件", "订单", "客户", "容量池", "来源引用"],
        },
      });
    },
  });
}

function cloudOpsDegradationPlanTool(): ToolDefinition {
  return defineTool({
    name: "cloud_ops_degradation_plan",
    description: "生成 Seedance/云商品上线事故降级方案，覆盖商品页降级、销售话术、客服通知、SRE 告警、回滚检查点和经营影响。只生成演示草稿。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, risks, tasks, gtmAssets] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.riskSignals),
        table(CLOUD.workflowTasks),
        table(CLOUD.gtmAssets),
      ]);
      const product = findProduct(products, args.product_code ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      if (!product) return fail("cloud_ops_degradation_plan", "product_not_found", "没有找到可降级评审的云商品。");
      const productId = String(product.product_id);
      const relatedRisks = risks.filter((risk) => asObject(risk.linked_entities).product_id === productId);
      const relatedTasks = tasks.filter((task) => task.linked_release_request_id && String(task.linked_release_request_id).includes(productId === "prod_seedance" ? "seedance" : String(product.product_code ?? "").toLowerCase()));
      const relatedGtm = gtmAssets.filter((asset) => asset.product_id === productId);
      return ok("cloud_ops_degradation_plan", {
        degradation_plan: {
          product,
          trigger_conditions: [
            "生成失败率连续 15 分钟高于阈值",
            "队列等待时间超过大促承诺边界",
            "内容安全审核或重试导致产出不稳定",
          ],
          product_page_degradation: [
            "商品页展示“当前为排队保护模式”，隐藏固定产能/固定交付暗示。",
            "自助购买入口改为“提交需求/销售跟进”，高峰期不直接承诺生效时间。",
            "估算卡片增加“演示估算/非正式报价/不承诺固定产能”提示。",
          ],
          sales_talk_degradation: [
            "销售只承诺预算测算和排队保护机制，不承诺固定生成秒数或固定完成时间。",
            "大促客户先确认日生成量、素材类型、审核要求和可接受排队窗口。",
            "合同折扣、资源包和促销价需要财务复核后才能进入正式报价。",
          ],
          sre_alerts: [
            "SRE 监控生成失败率、队列等待时间、重试率和审核积压。",
            "达到阈值后通知商品 PM、销售负责人、客服负责人和老板看板。",
            "恢复前保持限流策略，避免新增订单放大交付风险。",
          ],
          sales_notifications: [
            "通知销售：当前进入高峰保护，新增客户先走人工确认和排队沟通。",
            "重点客户由销售同步风险、替代方案和预计恢复窗口。",
          ],
          customer_support_notice: [
            "客服口径：当前为高峰保护，估算结果不是正式交付承诺。",
            "如客户已有订单，优先确认权益、排队状态和可选降级方案。",
          ],
          rollback_checkpoints: [
            "关闭新购入口或切到人工询价。",
            "恢复上一版购买页和价格快照。",
            "保留存量订阅权益并人工跟进受影响客户。",
          ],
          related_risks: relatedRisks,
          workflow_tasks: relatedTasks,
          gtm_assets: relatedGtm,
          production_mutation: false,
          data_boundary: "降级方案为 demo/mock 演示草稿，不代表真实生产事故或正式 SLA 承诺。",
          evidence_sources: ["风险信号", "流程任务", "GTM 材料", "演示假设"],
        },
      });
    },
  });
}

function cloudAgentPlanOveragePolicyTool(): ToolDefinition {
  return defineTool({
    name: "cloud_agent_plan_overage_policy",
    description: "生成 Agent Plan 套餐额度用完后的超额付费客户解释，说明是否自动扣费、谁确认、如何开启和账单提示。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:estimate"],
      risk_level: "read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({}).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute() {
      return ok("cloud_agent_plan_overage_policy", {
        overage_policy: {
          product_name: "Agent Plan 套餐",
          auto_charge: false,
          conclusion: "套餐额度用完后不会自动扣费；必须由客户管理员或授权联系人完成二次确认后，才生成超额付费开通草稿。",
          confirmation_owner: "客户管理员 / 授权采购联系人",
          confirmation_steps: [
            "账单页和用量页提前展示额度消耗、预计用尽时间和超额单价。",
            "客户点击开通超额付费时，只生成开通草稿，不立即生产生效。",
            "客户管理员确认预算、单价、上限和通知人后，进入人工/审批确认。",
            "确认前继续按套餐额度保护，避免客户无感扣费。",
          ],
          bill_notice: [
            "账单展示套餐内额度、已用额度、剩余额度和超额付费开关状态。",
            "超额付费发生前发送站内信/邮件/销售通知，客户确认后再进入正式计费。",
          ],
          sales_boundary: [
            "销售不能承诺固定对话轮数。",
            "销售不能替客户默认开启超额扣费。",
            "高成本模型、联网搜索、视频生成会显著影响 AFP 消耗，必须提前说明。",
          ],
          production_mutation: false,
          data_boundary: "该说明为 demo policy，用于演示客户友好解释和审批边界，不代表正式合同条款。",
          evidence_sources: ["回答策略样例", "用量估算器", "风险信号", "演示假设"],
        },
      });
    },
  });
}

function cloudRetrospectiveTemplateTool(): ToolDefinition {
  return defineTool({
    name: "cloud_retrospective_template",
    description: "把云商品从上架、销售、交付、经营风险复盘为下一次商品上架和客户成功检查模板。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:draft", "cloud:risk"],
      risk_level: "draft",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      product_code: z.string().max(80).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, checkpoints, risks, tasks, gtmAssets] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.ipdCheckpoints),
        table(CLOUD.riskSignals),
        table(CLOUD.workflowTasks),
        table(CLOUD.gtmAssets),
      ]);
      const product = findProduct(products, args.product_code ?? "SEEDANCE") ?? products.find((item) => item.product_id === "prod_seedance");
      if (!product) return fail("cloud_retrospective_template", "product_not_found", "没有找到可复盘云商品。");
      const productId = String(product.product_id);
      return ok("cloud_retrospective_template", {
        retrospective_template: {
          product,
          product_launch_checklist: [
            "IPD/PRD：明确目标客户、购买配置、商品范围和不可承诺项。",
            "财务毛利：明确最低毛利率、促销价/资源包/合同折扣互斥规则和审批阈值。",
            "SRE/容量：明确限流、队列、地域容量、灰度范围、告警阈值和回滚开关。",
            "法务/SLA：避免固定产能、固定交付日期和固定算力可用性承诺。",
            "GTM Ready：完成销售话术、客户 FAQ、报价前检查和禁承诺边界。",
            "发布审批：只生成草稿/审批摘要，人审确认后再进入生产流程。",
          ],
          customer_success_checklist: [
            "账单解释：提前说明估算和正式报价的差异，避免客户把 demo 估算当承诺。",
            "用量预警：对高成本模型、联网搜索、视频生成等成本项设置提醒。",
            "超额确认：额度用完后必须客户管理员二次确认，不自动扣费。",
            "续约闭环：按风险金额、续约概率、客户影响和下一步动作排序跟进。",
            "事故沟通：准备商品页降级、销售话术、客服通知和回滚检查点。",
          ],
          reusable_checkpoints: [
            "毛利底线",
            "折扣互斥",
            "容量/队列保护",
            "SLA 边界",
            "GTM ready",
            "客服通知",
            "销售报价检查",
            "经营指标复盘",
          ],
          related_checkpoints: checkpoints.filter((item) => item.product_id === productId),
          related_risks: risks.filter((risk) => asObject(risk.linked_entities).product_id === productId),
          related_tasks: tasks.filter((task) => String(task.linked_release_request_id ?? "").includes(productId === "prod_seedance" ? "seedance" : "")),
          related_gtm_assets: gtmAssets.filter((asset) => asset.product_id === productId),
          production_mutation: false,
          data_boundary: "复盘模板为 demo/mock 演示草稿，用于沉淀流程，不代表正式制度或生产变更。",
          evidence_sources: ["IPD 检查点", "风险信号", "流程任务", "GTM 材料", "演示假设"],
        },
      });
    },
  });
}

function cloudSolutionRecommendationTool(): ToolDefinition {
  return defineTool({
    name: "cloud_solution_recommendation",
    description: "面向销售场景，按客户行业、预算和需求组合推荐 Seedance、Agent Plan、TOS、CDN 等云商品套餐。最终回答必须显式包含“关键假设”“报价边界”“置信度”。",
    metadata: {
      required_permissions: ["cloud:read", "cloud:estimate"],
      risk_level: "read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      industry: z.string().max(120).optional(),
      budget_cny: z.number().min(1).optional(),
      needs: z.array(z.string().max(120)).max(12).optional(),
      customer_id: z.string().max(80).nullable().optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [products, skus, prices, refs] = await Promise.all([
        table(CLOUD.products),
        table(CLOUD.skus),
        table(CLOUD.prices),
        table(CLOUD.sourceRefs),
      ]);
      const budget = args.budget_cny ?? 100000;
      const needText = [args.industry, ...(args.needs ?? [])].join(" ");
      const isInfraScenario = /(ECS|GPU|RDS|CLB|金融|稳定|审计|核心|数据库|训练)/i.test(needText);
      const allocation = isInfraScenario
        ? [
          { product_code: "ECS", product_id: "prod_ecs", ratio: 0.48, reason: "承担 GPU 训练和核心计算负载，优先确认地域容量、规格和交付窗口。" },
          { product_code: "RDS_MYSQL", product_id: "prod_rds_mysql", ratio: 0.22, reason: "承载业务数据库，高可用、备份和审计是金融客户的基础要求。" },
          { product_code: "TOS", product_id: "prod_tos", ratio: 0.18, reason: "保存训练数据、模型产物、审计材料和备份归档。" },
          { product_code: "CLB", product_id: "prod_clb", ratio: 0.12, reason: "提供业务入口和流量调度，配合安全组/VPC 做访问控制。" },
        ]
        : [
          { product_code: "SEEDANCE", product_id: "prod_seedance", ratio: 0.42, reason: "承担短视频批量生成主成本，优先保障核心产出。" },
          { product_code: "AGENT_PLAN", product_id: "prod_agent_plan", ratio: 0.28, reason: "承载智能客服/运营助手的对话和工具调用额度。" },
          { product_code: "TOS", product_id: "prod_tos", ratio: 0.16, reason: "保存视频素材、成片、知识库文件和审计证据。" },
          { product_code: "CDN", product_id: "prod_cdn", ratio: 0.14, reason: "支撑成片分发、预览和峰值访问。" },
        ];
      const packagePlan = allocation.map((item) => {
        const product = products.find((row) => row.product_id === item.product_id);
        const productSkus = skus.filter((row) => row.product_id === item.product_id).slice(0, 3);
        const productPrices = prices.filter((row) => row.product_id === item.product_id || String(row.offer_id ?? "").includes(String(item.product_code).toLowerCase())).slice(0, 3);
        return {
          ...item,
          budget_cny: Math.round(budget * item.ratio),
          product_name: product?.product_name,
          suggested_skus: productSkus,
          price_evidence: productPrices,
          source_refs: product ? sourceRefsFor(product, refs) : [],
        };
      });
      return ok("cloud_solution_recommendation", {
        solution: {
          industry: args.industry ?? (isInfraScenario ? "金融 / AI 训练客户" : "内容行业"),
          needs: args.needs ?? (isInfraScenario ? ["GPU 训练", "业务数据库", "稳定性优先", "可审计", "合同折扣审批"] : ["短视频批量生成", "智能客服", "素材存储", "内容分发"]),
          budget_cny: budget,
          package_plan: packagePlan,
          sales_talk_track: isInfraScenario
            ? [
              "先确认地域、GPU 规格、训练窗口、业务数据库和审计要求，再给出正式报价。",
              "ECS GPU 是主成本项，RDS/TOS/CLB 是稳定性、备份、审计和访问入口的配套能力。",
              "新加坡地域需要容量预约；折扣、SLA 和合同价必须在正式报价前审批。",
            ]
            : [
              "先用 Seedance 做内容生成闭环，再用 Agent Plan 承接客服和运营问答。",
              "TOS/CDN 作为基础配套，避免视频生成后在存储、分发和账单解释上断链。",
              "预算拆分是 demo 估算，正式报价要结合合同折扣、地域、资源包、内容安全和峰值带宽复核。",
            ],
          assumptions: isInfraScenario
            ? [
              "客户预算用于 GPU 训练、业务数据库、对象存储和负载均衡的组合方案。",
              "预算拆分采用 demo 假设，不包含真实合同底价、专项促销和客户私有折扣。",
              "正式报价前需要复核地域容量、GPU 规格、SLA、合同折扣和审计要求。",
            ]
            : [
              "客户需求以短视频批量生成、智能客服、素材存储和内容分发为主。",
              "预算拆分采用 demo 假设，不包含真实合同底价、专项促销和客户私有折扣。",
              "正式报价前需要复核地域、资源包、内容安全、峰值带宽和超额用量。",
            ],
          answer_contract: [
            "关键假设：说明预算拆分、需求口径和 demo 数据来源。",
            "报价边界：说明这不是正式报价或固定产能承诺。",
            "置信度：给出 confidence，并说明正式报价前的复核项。",
          ],
          confidence: 0.68,
          boundary: isInfraScenario
            ? "方案是销售测算草稿，不是正式报价、库存承诺、固定交付日期或 SLA 承诺。"
            : "方案是销售测算草稿，不是正式报价或产能承诺。",
        },
      });
    },
  });
}

function cloudSelfServiceQuoteTool(): ToolDefinition {
  return defineTool({
    name: "cloud_self_service_quote",
    description: "客户自助询价：同时估算 Seedance 视频秒数和 Agent Plan 对话轮数，输出公式、假设、边界与置信度。",
    metadata: {
      required_permissions: ["cloud:estimate"],
      risk_level: "read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      budget_cny: z.number().min(1).optional(),
      quality: z.enum(["720p_standard", "720p_high", "1080p_standard", "1080p_high"]).nullable().optional(),
      target_duration_seconds: z.union([z.number().min(1).max(120), z.string().max(20)]).nullable().optional(),
      package_id: z.string().max(80).nullable().optional(),
      scenario_type: z.enum(["text_only", "agent_with_search", "image_understanding", "video_generation"]).nullable().optional(),
      customer_id: z.string().max(80).nullable().optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args, context) {
      const seedanceTool = estimateSeedanceVideoSecondsTool();
      const roundsTool = estimateAgentPlanRoundsTool();
      const [seedance, rounds] = await Promise.all([
        seedanceTool.execute({
          budget_cny: args.budget_cny ?? 10000,
          quality: args.quality ?? "720p_standard",
          target_duration_seconds: normalizePositiveNumber(args.target_duration_seconds, 5),
          customer_id: args.customer_id,
        }, context),
        roundsTool.execute({
          package_id: args.package_id ?? "agent_plan_medium",
          scenario_type: args.scenario_type ?? "agent_with_search",
        }, context),
      ]);
      return ok("cloud_self_service_quote", {
        quote: {
          seedance,
          agent_plan: rounds,
          disclaimer: "自助询价仅用于预算沟通；正式报价需按合同、地域、资源包、内容安全审核和实际调用形态复核。",
        },
      });
    },
  });
}

function cloudReleaseRiskReviewTool(): ToolDefinition {
  return defineTool({
    name: "cloud_release_risk_review",
    description: "对云商品发布申请做上线前风险审查，输出风险等级、风险项、阻塞任务、影响客户和建议动作。",
    metadata: {
      required_permissions: ["cloud:risk"],
      risk_level: "sensitive_read",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      release_request_id: z.string().min(1).max(120),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [releases, risks, tasks, approvals, refs] = await Promise.all([
        table(CLOUD.releaseRequests),
        table(CLOUD.riskSignals),
        table(CLOUD.workflowTasks),
        table(CLOUD.approvalTasks),
        table(CLOUD.sourceRefs),
      ]);
      const release = releases.find((item) => item.release_request_id === args.release_request_id);
      if (!release) return fail("cloud_release_risk_review", "release_not_found", "没有找到发布申请。");
      const relatedRisks = risks.filter((risk) => {
        const linked = asObject(risk.linked_entities);
        return linked.release_request_id === release.release_request_id || linked.product_id === release.product_id;
      });
      const relatedTasks = tasks.filter((task) => task.linked_release_request_id === release.release_request_id);
      const relatedApprovals = approvals.filter((task) => task.release_request_id === release.release_request_id);
      const riskLevel = rankRisk(relatedRisks, relatedTasks);
      return ok("cloud_release_risk_review", {
        risk_report: {
          release_request: release,
          risk_level: riskLevel,
          requires_human_review: true,
          risk_items: relatedRisks,
          blocking_tasks: relatedTasks.filter((task) => task.status === "blocked" || Number(task.delay_hours ?? 0) > 0),
          approval_tasks: relatedApprovals,
          impacted_customers: inferImpactedCustomers(String(release.product_id ?? "")),
          recommended_actions: Array.from(new Set(relatedRisks.flatMap((risk) => Array.isArray(risk.recommended_actions) ? risk.recommended_actions.map(String) : []))),
          rollback_plan: release.rollback_plan,
          source_refs: sourceRefsFor(release, refs),
        },
      });
    },
  });
}

function createCloudReleaseDraftTool(): ToolDefinition {
  return defineTool({
    name: "create_cloud_release_draft",
    description: "创建云商品发布申请草稿。该工具只返回草稿，不写入生产状态。",
    metadata: {
      required_permissions: ["cloud:draft"],
      risk_level: "draft",
      requires_confirmation: true,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      product_id: z.string().min(1).max(120),
      title: z.string().max(160).optional(),
      change_type: z.string().max(80).optional(),
      summary: z.string().max(2000).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args, context) {
      const now = new Date().toISOString();
      return ok("create_cloud_release_draft", {
        draft: {
          release_request_id: `draft_${args.product_id}_${Date.now()}`,
          product_id: args.product_id,
          title: args.title ?? "云商品发布草稿",
          change_type: args.change_type ?? "new_offer",
          status: "draft_only",
          requested_by: context?.user?.id ?? "unknown_user",
          summary: args.summary ?? "",
          rollback_plan: "待补充：关闭新购入口、恢复价格快照、保留存量权益并公告回滚窗口。",
          mocked: true,
        },
        audit: {
          action: "draft_created",
          at: now,
          production_mutation: false,
          checkpoint: "需要人工确认后才能进入审批流。",
        },
      });
    },
  });
}

function createCloudApprovalSummaryTool(): ToolDefinition {
  return defineTool({
    name: "create_cloud_approval_summary",
    description: "生成云商品发布审批摘要草稿，包含变更内容、风险、人审边界和回滚检查点。",
    metadata: {
      required_permissions: ["cloud:draft"],
      risk_level: "draft",
      requires_confirmation: false,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      release_request_id: z.string().min(1).max(120),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const [releases, approvals, tasks, risks] = await Promise.all([
        table(CLOUD.releaseRequests),
        table(CLOUD.approvalTasks),
        table(CLOUD.workflowTasks),
        table(CLOUD.riskSignals),
      ]);
      const release = releases.find((item) => item.release_request_id === args.release_request_id);
      if (!release) return fail("create_cloud_approval_summary", "release_not_found", "没有找到发布申请。");
      const approvalTasks = approvals.filter((task) => task.release_request_id === release.release_request_id);
      const workflowTasks = tasks.filter((task) => task.linked_release_request_id === release.release_request_id);
      const relatedRisks = risks.filter((risk) => asObject(risk.linked_entities).release_request_id === release.release_request_id || asObject(risk.linked_entities).product_id === release.product_id);
      return ok("create_cloud_approval_summary", {
        approval_summary: {
          title: release.title,
          release_request_id: release.release_request_id,
          change_type: release.change_type,
          current_status: release.status,
          risk_level: rankRisk(relatedRisks, workflowTasks),
          approval_tasks: approvalTasks,
          blocking_tasks: workflowTasks.filter((task) => task.status === "blocked"),
          human_review_required: true,
          rollback_checkpoint: release.rollback_plan,
          customer_support_notice: [
            "若灰度、限售或延期，请客服说明当前为发布前演示/估算口径，正式价格、产能和交付窗口需人工确认。",
            "客户问到 SLA、固定产能或固定交付日期时，只能引用合同已确认条款，不得承诺未审批能力。",
            "如需对外公告，由商品 PM、SRE、销售和法务共同确认后再发布。"
          ],
          recommended_decision: relatedRisks.some((risk) => risk.severity === "high") ? "hold_for_review" : "approve_after_checks",
          production_mutation: false,
        },
      });
    },
  });
}

function simulateCloudClosedLoopTool(): ToolDefinition {
  return defineTool({
    name: "simulate_cloud_closed_loop",
    description: "模拟云商品半自动闭环：配置草稿、风险审查、审批、人审确认、灰度发布、公告和回滚检查点。不执行真实发布。",
    metadata: {
      required_permissions: ["cloud:draft"],
      risk_level: "draft",
      requires_confirmation: true,
      expose_to_agentic: true,
      intents: ["mixed"],
    },
    inputSchema: z.object({
      release_request_id: z.string().min(1).max(120),
      gray_scope: z.string().max(80).optional(),
    }).strict(),
    outputSchema: ToolResultBaseSchema,
    async execute(args) {
      const releases = await table(CLOUD.releaseRequests);
      const release = releases.find((item) => item.release_request_id === args.release_request_id);
      if (!release) return fail("simulate_cloud_closed_loop", "release_not_found", "没有找到发布申请。");
      return ok("simulate_cloud_closed_loop", {
        closed_loop_plan: {
          release_request: release,
          gray_scope: args.gray_scope ?? "internal",
          requires_human_review: true,
          production_mutation: false,
          steps: [
            { step: "collect_evidence", owner: "商品平台", action: "收集 Product/Offer/SKU/Meter/Price/source_refs 证据", status: "ready" },
            { step: "batch_config_draft", owner: "商品平台", action: "生成批量配置草稿，不生效", status: "ready" },
            { step: "risk_review", owner: "商品平台/财务/法务", action: "审查价格、合同、内容安全和存量客户影响", status: "manual_review_required" },
            { step: "approval_summary", owner: "审批人", action: "确认审批摘要、风险项和回滚方案", status: "waiting" },
            { step: "gray_release", owner: "SRE/商品平台", action: "仅在灰度范围开放购买入口", status: "blocked_until_approval" },
            { step: "announcement", owner: "运营/销售", action: "生成公告和销售 FAQ 草稿", status: "ready" },
            { step: "rollback_checkpoint", owner: "SRE/商品平台", action: "记录价格快照、入口开关和恢复步骤", status: "ready" },
          ],
        },
      });
    },
  });
}

function buildPurchaseFields(product: Row, specs: Row[], meters: Row[]) {
  const base = [
    { field: "region_id", label: "地域", required: true, source: "cloud_regions" },
    { field: "billing_mode", label: "计费模式", required: true, source: "cloud_offers" },
    { field: "sku_id", label: "规格/SKU", required: true, source: "cloud_skus" },
  ];
  const specFields = specs
    .filter((spec) => spec.required_for_purchase === true)
    .slice(0, 8)
    .map((spec) => ({
      field: String(spec.spec_key),
      label: String(spec.spec_name ?? spec.spec_key),
      required: true,
      unit: spec.spec_unit ?? "",
      source: "cloud_specs",
    }));
  const meterFields = meters.slice(0, 4).map((meter) => ({
    field: String(meter.meter_code ?? meter.meter_id),
    label: String(meter.meter_name ?? meter.meter_id),
    required: false,
    unit: meter.meter_unit ?? "",
    source: "cloud_meters",
  }));
  const aiSafety = String(product.product_category ?? "").includes("AI")
    ? [{ field: "content_safety_policy", label: "内容安全策略", required: true, source: "cloud_risk_rules" }]
    : [];
  return uniquePurchaseFields([...base, ...specFields, ...meterFields, ...aiSafety]);
}

function uniquePurchaseFields(fields: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = String(field.field ?? field.label ?? "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferMissingFields(product: Row, prices: Row[], meters: Row[]) {
  const missing: string[] = [];
  if (!prices.length) missing.push("price_rules");
  if (!meters.length) missing.push("meters");
  if (String(product.product_category ?? "").includes("AI")) {
    missing.push("content_safety_terms_review", "model_cost_floor_review");
  }
  return missing;
}

function rankRisk(risks: Row[], tasks: Row[]): string {
  if (risks.some((risk) => risk.severity === "high")) return "high";
  if (tasks.some((task) => task.status === "blocked" || Number(task.delay_hours ?? 0) > 0)) return "medium";
  if (risks.length) return "medium";
  return "low";
}

function inferImpactedCustomers(productId: string) {
  if (productId === "prod_seedance") return [{ customer_id: "cust_ai_studio", name: "灵犀内容智能科技有限公司", impact: "视频生成套餐、合同折扣和内容安全条款" }];
  if (productId === "prod_agent_plan") return [{ customer_id: "cust_ai_studio", name: "灵犀内容智能科技有限公司", impact: "Agent Plan AFP 消耗与超额后付费" }];
  if (productId === "prod_cdn") return [{ customer_id: "cust_media_stream", name: "星河传媒集团", impact: "CDN 资源包续约与账单解释" }];
  return [];
}

function riskScore(row: Row): number {
  const severity = String(row.severity ?? "");
  const severityScore = severity === "high" ? 100 : severity === "medium" ? 60 : severity === "low" ? 20 : 0;
  return severityScore + Number(row.impact_amount_cny ?? 0) / 10000 + Number(row.delay_hours ?? 0);
}

function renewalAmountAtRisk(row: Row): number {
  const currentArr = Number(row.current_arr_cny ?? 0);
  const probability = Number(row.renewal_probability ?? 0);
  if (!Number.isFinite(currentArr) || currentArr <= 0) return 0;
  if (!Number.isFinite(probability)) return currentArr;
  return Math.round(currentArr * Math.max(0, 1 - probability));
}

function buildOperatingSnapshot(metrics: Row[]) {
  const byName = new Map(metrics.map((row) => [String(row.metric_name ?? row.metric_id), row]));
  const get = (name: string) => byName.get(name);
  return {
    as_of_date: metrics[0]?.as_of_date ?? null,
    gmv_mtd_cny: get("GMV MTD")?.metric_value ?? null,
    net_revenue_mtd_cny: get("Net Revenue MTD")?.metric_value ?? null,
    gross_margin_rate: get("Gross Margin Rate")?.metric_value ?? null,
    active_paying_customers: get("Active Paying Customers")?.metric_value ?? null,
    arr_at_risk_cny: get("ARR At Risk")?.metric_value ?? null,
    bill_dispute_amount_cny: get("Bill Dispute Amount")?.metric_value ?? null,
    blocked_release_tasks: get("Blocked Release Tasks")?.metric_value ?? null,
    top_watch_items: metrics
      .filter((row) => ["risk", "watch"].includes(String(row.status ?? "")))
      .slice(0, 5)
      .map((row) => ({
        metric_id: row.metric_id,
        metric_name: row.metric_name,
        value: row.metric_value,
        unit: row.unit,
        change_rate: row.change_rate,
        status: row.status,
        owner_team: row.owner_team,
        insight: row.insight,
        mocked: row.mocked,
        confidence: row.confidence,
      })),
  };
}

function customerNamesFromLinkedEntities(row: Row, customerById: Map<string, Row>): string[] {
  const linked = asObject(row.linked_entities);
  const ids = [
    linked.customer_id,
    ...(Array.isArray(linked.customer_ids) ? linked.customer_ids : []),
  ].map(String).filter(Boolean);
  return ids.map((id) => String(customerById.get(id)?.customer_name ?? id));
}

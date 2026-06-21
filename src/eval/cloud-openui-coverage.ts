import { buildOpenUILangLegacyEnvelopes } from "../openui-lang/index.js";
import { AVAILABLE_PACKS, DomainRegistry } from "../domains/index.js";
import { setRuntimeRegistryAccessor } from "../domains/runtime-registry.js";
import type { JsonObject } from "../types/agent-contracts.js";

const registry = new DomainRegistry();
registry.registerMany(AVAILABLE_PACKS);
await registry.initialize();
setRuntimeRegistryAccessor(registry);

const cases: Array<{ name: string; result: JsonObject; expected: string }> = [
  {
    name: "executive briefing",
    expected: "AnalyticsDashboardSurface",
    result: toolResult("cloud_executive_briefing", {
      executive_briefing: {
        conclusion: "当前应优先处理高风险发布与客户续约敞口，暂不建议无人工复核直接放量。",
        operating_snapshot: { gmv_cny: 1280000, net_revenue_cny: 960000, gross_margin_rate: 0.31, active_customers: 42, dispute_amount_cny: 62000 },
        amount_at_risk_cny: 246076,
        top_risks: [{ risk_id: "risk_1", severity: "high", risk_name: "低毛利促销未经复核", owner_user_id: "finance_reviewer_001", impact_amount_cny: 96000 }],
        blocking_tasks: [{ task_id: "task_1", task_name: "模型价格复核", status: "blocked", delay_hours: 18, owner_team: "finance" }],
        renewal_risks: [{ customer_name: "示例媒体客户", risk_level: "high", arr_at_risk_cny: 246076, owner_user_id: "sales_media_001" }],
        next_actions: ["请财务复核负责人今天内补齐价格证据并解除阻塞。"],
        evidence_sources: ["经营指标", "风险信号", "流程任务", "续约机会"],
        data_boundary: "demo/mock 经营样本，不能表达为云厂商官方披露或正式承诺。"
      }
    })
  },
  {
    name: "solution recommendation",
    expected: "AnalyticsDashboardSurface",
    result: toolResult("cloud_solution_recommendation", {
      solution: {
        budget_cny: 100000,
        package_plan: [
          { product_code: "SEEDANCE", product_name: "视频生成", ratio: 0.42, budget_cny: 42000, reason: "承担短视频批量生成主成本。" },
          { product_code: "AGENT_PLAN", product_name: "智能体套餐", ratio: 0.28, budget_cny: 28000, reason: "承载客服和运营问答。" }
        ],
        assumptions: ["预算拆分采用 demo 假设。"],
        confidence: 0.68,
        boundary: "方案是销售测算草稿，不是正式报价或产能承诺。"
      }
    })
  },
  {
    name: "self service quote",
    expected: "AnalyticsDashboardSurface",
    result: toolResult("cloud_self_service_quote", {
      quote: {
        seedance: { data: { estimate: { estimated_seconds: 860, estimated_video_count: 172, formula: "floor(net_budget / price_per_1k_tokens * 1000 / token_per_second * effective_ratio)", assumptions: { token_per_second: 1800 }, confidence: 0.7, boundary: "不是固定产能承诺。" } } },
        agent_plan: { data: { estimate: { estimated_rounds: 23000, formula: "floor(available_afp / turn_afp * safety_buffer)", assumptions: { average_turn_total_tokens: 2000 }, confidence: 0.74, boundary: "受工具调用和多模态输入影响。" } } },
        disclaimer: "自助询价仅用于预算沟通。"
      }
    })
  },
  {
    name: "agent estimate",
    expected: "MetricCardsSurface",
    result: toolResult("estimate_agent_plan_rounds", {
      estimate: { estimated_rounds: 23000, available_afp: 500000, formula: "floor(available_afp / turn_afp * safety_buffer)", assumptions: { average_turn_total_tokens: 2000 }, confidence: 0.72, boundary: "估算不是固定产能承诺。" }
    })
  },
  {
    name: "seedance estimate",
    expected: "MetricCardsSurface",
    result: toolResult("estimate_seedance_video_seconds", {
      estimate: { estimated_seconds: 860, estimated_video_count: 172, formula: "floor(net_budget / price_per_1k_tokens * 1000 / token_per_second * effective_ratio)", assumptions: { token_per_second: 1800 }, confidence: 0.7, boundary: "真实结果受质量档位影响。" }
    })
  },
  {
    name: "product model draft",
    expected: "ProductLaunchFormSurface",
    result: toolResult("cloud_product_model_draft", {
      draft: {
        product: { product_code: "SEEDANCE", product_name: "视频生成" },
        purchase_page_fields: [{ field: "region_id", label: "地域", required: true, source: "cloud_regions" }, { field: "billing_mode", label: "计费模式", required: true, source: "cloud_offers" }],
        missing_fields: ["price_rules"],
        review_notes: ["价格、合同折扣、资源包抵扣和内容安全规则必须经过人工复核。"]
      }
    })
  },
  {
    name: "productization review",
    expected: "ProductLaunchFormSurface",
    result: toolResult("cloud_productization_readiness_review", {
      productization_review: {
        product: { product_name: "Seedance Mini" },
        review: { product_name: "Seedance Mini", capability_stage: "模型能力已验证，产品定义待补齐" },
        readiness_score: 62,
        overall_status: "needs_product_definition",
        target_customers: ["电商商品视频团队"],
        value_proposition: "包装为可自助购买云商品。",
        deliverables: [{ name: "能力边界与不可承诺项", status: "in_progress", status_label: "处理中", owner: "商品 PM", gap: "固定生成成功率需明确", next_action: "补齐销售禁承诺口径" }],
        blockers: [{ name: "成本测算输入", gap: "缺少失败重试成本" }],
        boundary_items: ["不能承诺固定生成成功率"],
        cost_inputs: ["模型推理成本"],
        sla_draft: "只承诺服务处理流程和排队保护。",
        next_actions: ["补齐产品定义交付物。"],
        evidence_sources: ["产品化定义评审", "产品主数据"],
        data_boundary: "demo/mock 演示数据。"
      }
    })
  },
  {
    name: "offer design review",
    expected: "AnalyticsDashboardSurface",
    result: toolResult("cloud_offer_design_review", {
      offer_design_review: {
        product: { product_name: "Agent Plan" },
        offers: [{ offer_name: "包月套餐" }],
        skus: [{ sku_name: "Medium" }],
        meters: [{ meter_name: "AFP" }],
        prices: [{ price_type: "目录价", unit_price: 100 }],
        relation_rows: [{ offer_name: "包月套餐", billing_mode: "包月", purchase_mode: "自助", skus: ["Medium"], meters: ["AFP"], prices: ["目录价 100 CNY"] }],
        conflicts: ["超额付费必须二次确认。"],
        next_actions: ["拆清权益和超额策略。"],
        evidence_sources: ["Offer", "SKU", "计费项", "价格规则"],
        data_boundary: "demo/mock 样本。"
      }
    })
  },
  {
    name: "entitlement review",
    expected: "ProductLaunchFormSurface",
    result: toolResult("cloud_plan_entitlement_review", {
      entitlement_review: {
        product: { product_name: "Agent Plan" },
        rules: [{ entitlement_name: "每日赠送 50 元等值 Token", grant_rule: "每日登录后发放", consume_order: "先赠送后套餐", expiry_rule: "当日失效", unsubscribe_rule: "退订停止发放", refund_rule: "赠送权益不退款", overage_policy: "客户二次确认", billing_explanation: "账单分开展示额度" }],
        risk_items: ["必须客户二次确认后才能生效。"],
        next_actions: ["账单页同步解释权益边界。"],
        evidence_sources: ["套餐权益规则"],
        data_boundary: "demo/mock 演示规则。"
      }
    })
  },
  {
    name: "channel publication review",
    expected: "AnalyticsDashboardSurface",
    result: toolResult("cloud_channel_publication_review", {
      channel_publication_review: {
        product: { product_name: "Seedance Mini" },
        channels: [{ channel: "官网", channel_purpose: "营销获客", visible_fields: ["商品名称"], hidden_fields: ["内部成本"], source_of_truth: "商品中台主数据", publication_status: "ready_with_warnings", owner: "GTM 负责人", precheck: "展示非正式报价边界" }],
        blocked_channels: [],
        next_actions: ["确认商品中台是主数据源。"],
        evidence_sources: ["渠道发布矩阵"],
        data_boundary: "demo/mock 演示数据。"
      }
    })
  },
  {
    name: "sre launch gate review",
    expected: "AnalyticsDashboardSurface",
    result: toolResult("cloud_sre_launch_gate_review", {
      sre_launch_gate_review: {
        product: { product_name: "Seedance Mini" },
        gates: [{ gate_name: "模型生成容量", status: "blocked", status_label: "已阻塞", owner: "SRE 运维团队", metric: "队列等待时间", threshold: "P95 低于 5 分钟", risk_if_missing: "客户排队过长", next_action: "输出限流阈值", rollback_trigger: "连续超阈值", customer_notice: "排队保护模式" }],
        blockers: [{ gate_name: "模型生成容量" }],
        next_actions: ["SRE 门禁只生成巡检计划。"],
        evidence_sources: ["SRE 上架门禁"],
        data_boundary: "demo/mock 演示数据。"
      }
    })
  },
  {
    name: "release risk",
    expected: "RiskListSurface",
    result: toolResult("cloud_release_risk_review", {
      risk_report: {
        risk_level: "high",
        requires_human_review: true,
        risk_items: [{ risk_id: "risk_release", severity: "high", risk_name: "价格证据不足", owner_team: "finance", impact_amount_cny: 52000 }],
        blocking_tasks: [{ task_id: "task_release", task_name: "内容安全条款审核", status: "blocked", delay_hours: 12, owner_user_id: "legal_001" }],
        rollback_plan: "关闭新购入口并恢复价格快照。"
      }
    })
  },
  {
    name: "approval summary",
    expected: "DataTableSurface",
    result: toolResult("create_cloud_approval_summary", {
      approval_summary: {
        title: "Seedance Mini 上架",
        current_status: "in_progress",
        risk_level: "high",
        recommended_decision: "hold_for_review",
        human_review_required: true,
        rollback_checkpoint: "关闭新购入口并恢复价格快照。"
      }
    })
  },
  {
    name: "release draft",
    expected: "DataTableSurface",
    result: toolResult("create_cloud_release_draft", {
      draft: { title: "云商品发布草稿", product_id: "prod_seedance", change_type: "new_offer", status: "draft_only", rollback_plan: "待补充回滚方案。" },
      audit: { checkpoint: "需要人工确认后才能进入审批流。" }
    })
  },
  {
    name: "closed loop",
    expected: "DataTableSurface",
    result: toolResult("simulate_cloud_closed_loop", {
      closed_loop_plan: {
        gray_scope: "internal",
        requires_human_review: true,
        steps: [
          { step: "collect_evidence", owner: "商品平台", action: "收集证据", status: "ready" },
          { step: "risk_review", owner: "财务/法务", action: "审查价格和条款", status: "manual_review_required" },
          { step: "gray_release", owner: "SRE", action: "灰度开放购买入口", status: "blocked_until_approval" }
        ]
      }
    })
  }
];

for (const item of cases) {
  const envelopes = buildOpenUILangLegacyEnvelopes({
    result: {
      run_id: `run_${item.name.replace(/\W+/g, "_")}`,
      user_message: "请用云商品业务驾驶舱展示",
      debug: { tool_results: [item.result] }
    }
  });
  const dataModels = envelopes.map((envelope) => envelope.updateDataModel?.value).filter(Boolean) as JsonObject[];
  const cloudData = dataModels.find((data) => readPath(data, ["domain"]) === "云商品平台");
  assert(Boolean(cloudData), `${item.name} should create cloud commodity OpenUI surface`);
  assert(readPath(cloudData, ["openui", "component"]) === "BusinessBriefSurface", `${item.name} should render BusinessBriefSurface first`);
  assert(readPath(cloudData, ["openui", "props", "details", "component"]) === item.expected, `${item.name} should keep ${item.expected} as detail surface`);
  assert(String(readPath(cloudData, ["openui", "props", "verdict"]) ?? "").length > 0, `${item.name} should expose a readable verdict`);
  assertNoRawEngineeringText(cloudData!, `${item.name} should hide engineering keys`);
}

console.log(`cloud-openui-coverage ok (${cases.length} cases)`);

function toolResult(tool: string, data: JsonObject): JsonObject {
  return { ok: true, tool, data };
}

function readPath(value: unknown, path: (string | number)[]): unknown {
  let cursor = value;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[key];
    } else {
      if (typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
      cursor = (cursor as Record<string, unknown>)[key];
    }
  }
  return cursor;
}

function assertNoRawEngineeringText(value: JsonObject, message: string): void {
  const visible = JSON.stringify({
    props: readPath(value, ["openui", "props"]),
    source_labels: value.source_labels,
    tool_label: value.tool_label
  });
  const banned = [
    "severity=high",
    "delay_hours>0",
    "arr_at_risk_cny",
    "owner_user_id",
    "owner_team",
    "metric_id",
    "source_type",
    "cloud_operating_metrics",
    "cloud_risk_signals",
    "cloud_workflow_tasks",
    "cloud_renewal_opportunities",
    "cloud_productization_reviews",
    "cloud_entitlement_rules",
    "cloud_channel_publication_matrix",
    "cloud_sre_readiness_gates",
    "cloud_source_refs",
    "net_budget",
    "price_per_1k_tokens",
    "token_per_second",
    "effective_ratio",
    "available_afp",
    "turn_afp",
    "safety_buffer"
  ];
  for (const token of banned) {
    assert(!visible.includes(token), `${message}: leaked ${token}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

import type { ReportComposerDefinition } from "../types.js";
import type { JsonObject, ToolResult } from "../../types/agent-contracts.js";

export const CLOUD_REPORT_COMPOSERS: ReportComposerDefinition[] = [
  {
    id: "cloud.product_model_draft",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_product_model_draft"),
    compose: ({ toolResults }) => {
      const draft = readData(toolResults, "cloud_product_model_draft", "draft");
      if (!draft) return null;
      const product = toRecord(draft.product) ?? {};
      const offers = readArray(draft.offers);
      const skus = readArray(draft.skus);
      const meters = readArray(draft.meters);
      const prices = readArray(draft.prices);
      const fields = readArray(draft.purchase_page_fields);
      return {
        answer: [
          `结论：已生成「${label(product.product_name ?? product.product_code ?? "新商品")}」的云商品建模草稿。所有内容仅为草稿/演示假设，不会写入生产或自动上架。`,
          "",
          `Product：${label(product.product_name)}；品类 ${label(product.product_category)}；Provider ${label(product.provider)}。`,
          `Offer：${offers.map((item) => label(item.offer_name ?? item.offer_id)).join("、") || "待补齐"}。`,
          `SKU：${skus.map((item) => label(item.sku_name ?? item.sku_id)).join("、") || "待补齐"}。`,
          `计量项：${meters.map((item) => label(item.meter_name ?? item.meter_code)).join("、") || "待补齐"}。`,
          "",
          "购买/配置字段：",
          ...fields.slice(0, 10).map((item, index) => `${index + 1}. ${label(item.label ?? item.field)}：${item.required === true ? "必填" : "可选"}；${label(item.unit ? `单位 ${item.unit}` : "按购买配置确认")}。`),
          "",
          "价格与权益草稿：",
          ...(prices.length ? prices.map((item, index) => `${index + 1}. ${label(item.price_name)}；${label(item.pricing_rule ?? "价格规则待复核")}。`) : ["1. 价格规则待财务补齐。"]),
          "",
          `待补齐：${readStringArray(draft.missing_fields).join("、") || "暂无明显缺口"}`,
          "下一步：请商品 PM 确认商品范围和购买配置；财务复核 Token 单价、会员赠送额度和毛利底线；法务/SRE 确认 SLA、内容安全和不可承诺边界；之后再生成发布审批摘要。",
          `数据边界：${label(draft.data_boundary ?? "新商品建模结果为 demo/草稿，不代表正式价格、正式库存、SLA 或已完成上架。")}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.productization_readiness_review",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_productization_readiness_review"),
    compose: ({ toolResults }) => {
      const review = readData(toolResults, "cloud_productization_readiness_review", "productization_review");
      if (!review) return null;
      const productName = label(readPath(review, ["product", "product_name"]) ?? readPath(review, ["review", "product_name"]) ?? "云产品能力");
      const blockers = readArray(review.blockers);
      return {
        answer: [
          `结论：${productName} 产品化就绪度约 ${numberText(review.readiness_score)}%，当前状态为「${label(review.overall_status)}」。这是产品定义评审草稿，不会直接上架。`,
          "",
          `目标客户：${listText(review.target_customers)}。`,
          `客户价值：${label(review.value_proposition)}。`,
          "产品定义交付物：",
          ...readArray(review.deliverables).map((item, index) => `${index + 1}. ${label(item.name)}：${label(item.status_label ?? item.status)}；负责人 ${label(item.owner)}；缺口 ${label(item.gap ?? "暂无")}；动作 ${label(item.next_action)}。`),
          "",
          `能力边界：${listText(review.boundary_items)}。`,
          `成本输入：${listText(review.cost_inputs)}。`,
          `SLA 初稿：${label(review.sla_draft)}。`,
          `阻塞项：${blockers.length ? blockers.map((item) => label(item.name)).join("、") : "暂无"}。`,
          "后续动作：",
          ...readStringArray(review.next_actions).map((item) => `- ${item}`),
          `数据边界：${label(review.data_boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.offer_design_review",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_offer_design_review"),
    compose: ({ toolResults }) => {
      const review = readData(toolResults, "cloud_offer_design_review", "offer_design_review");
      if (!review) return null;
      const productName = label(readPath(review, ["product", "product_name"]) ?? "云商品");
      return {
        answer: [
          `结论：${productName} 已完成 Offer/SKU/计量/价格关系评审，发现 ${readStringArray(review.conflicts).length} 个治理重点。`,
          "",
          "关系梳理：",
          ...readArray(review.relation_rows).map((item, index) => `${index + 1}. ${label(item.offer_name)}：计费模式 ${label(item.billing_mode)}；SKU ${listText(item.skus)}；计量项 ${listText(item.meters)}；价格关系 ${listText(item.prices)}。`),
          "",
          "治理重点：",
          ...readStringArray(review.conflicts).map((item) => `- ${item}`),
          "后续动作：",
          ...readStringArray(review.next_actions).map((item) => `- ${item}`),
          `数据边界：${label(review.data_boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.plan_entitlement_review",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_plan_entitlement_review"),
    compose: ({ toolResults }) => {
      const review = readData(toolResults, "cloud_plan_entitlement_review", "entitlement_review");
      if (!review) return null;
      const productName = label(readPath(review, ["product", "product_name"]) ?? "Plan 型商品");
      return {
        answer: [
          `结论：${productName} 已生成权益治理草稿。超额付费默认不自动扣费，必须客户二次确认后才生成开通草稿。`,
          "",
          "权益规则：",
          ...readArray(review.rules).map((item, index) => `${index + 1}. ${label(item.entitlement_name)}：发放 ${label(item.grant_rule)}；消耗 ${label(item.consume_order)}；过期 ${label(item.expiry_rule)}；超额 ${label(item.overage_policy)}；账单解释 ${label(item.billing_explanation)}。`),
          "",
          "风险项：",
          ...readStringArray(review.risk_items).map((item) => `- ${item}`),
          "后续动作：",
          ...readStringArray(review.next_actions).map((item) => `- ${item}`),
          `数据边界：${label(review.data_boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.channel_publication_review",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_channel_publication_review"),
    compose: ({ toolResults }) => {
      const review = readData(toolResults, "cloud_channel_publication_review", "channel_publication_review");
      if (!review) return null;
      const productName = label(readPath(review, ["product", "product_name"]) ?? "云商品");
      return {
        answer: [
          `结论：${productName} 已生成渠道发布矩阵。商品主数据以商品中台为准；官网、控制台、销售报价和 API/Marketplace 都是发布渠道。`,
          "",
          "渠道矩阵：",
          ...readArray(review.channels).map((item, index) => `${index + 1}. ${label(item.channel)}：用途 ${label(item.channel_purpose)}；可展示 ${listText(item.visible_fields)}；禁展示 ${listText(item.hidden_fields)}；状态 ${label(item.publication_status)}；负责人 ${label(item.owner)}。`),
          "",
          "后续动作：",
          ...readStringArray(review.next_actions).map((item) => `- ${item}`),
          `数据边界：${label(review.data_boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.sre_launch_gate_review",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_sre_launch_gate_review"),
    compose: ({ toolResults }) => {
      const review = readData(toolResults, "cloud_sre_launch_gate_review", "sre_launch_gate_review");
      if (!review) return null;
      const productName = label(readPath(review, ["product", "product_name"]) ?? "云商品");
      return {
        answer: [
          `结论：${productName} 上架前有 ${readArray(review.blockers).length} 个 SRE 门禁需要复核。容量、限流、告警、灰度、回滚和客户通知确认前，不建议直接放量。`,
          "",
          "SRE 门禁：",
          ...readArray(review.gates).map((item, index) => `${index + 1}. ${label(item.gate_name)}：${label(item.status_label ?? item.status)}；负责人 ${label(item.owner)}；指标 ${label(item.metric)}；阈值 ${label(item.threshold)}；后续动作 ${label(item.next_action)}。`),
          "",
          "后续动作：",
          ...readStringArray(review.next_actions).map((item) => `- ${item}`),
          `数据边界：${label(review.data_boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.seedance_video_estimate",
    matches: ({ toolResults }) => hasTool(toolResults, "estimate_seedance_video_seconds"),
    compose: ({ toolResults }) => {
      const estimate = readData(toolResults, "estimate_seedance_video_seconds", "estimate");
      if (!estimate) return null;
      return {
        answer: [
          `自助估算结论：按当前 demo 假设，预算 ${currency(estimate.budget_cny)} 可生成约 ${numberText(estimate.estimated_video_seconds)} 秒 Seedance 视频，折算约 ${numberText(estimate.estimated_video_count)} 条目标时长视频。`,
          `计算公式：${formulaText(estimate.formula)}`,
          `关键假设：${assumptionsText(estimate.assumptions)}；合同折扣 ${confidenceText(estimate.contract_discount)}；质量档位 ${label(estimate.quality)}。`,
          `置信度：${confidenceText(estimate.confidence)}。`,
          `报价边界：${label(estimate.boundary)} 这不是正式报价，正式报价还要复核合同、地域、资源包、内容安全审核和实际调用形态。`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.agent_plan_round_estimate",
    matches: ({ toolResults }) => hasTool(toolResults, "estimate_agent_plan_rounds"),
    compose: ({ toolResults }) => {
      const estimate = readData(toolResults, "estimate_agent_plan_rounds", "estimate");
      if (!estimate) return null;
      return {
        answer: [
          `自助估算结论：${label(estimate.recommended_plan)} 在当前 demo 假设下约可支持 ${numberText(estimate.estimated_rounds)} 轮对话，单轮约 ${numberText(estimate.estimated_afp_per_round)} AFP。`,
          `计算公式：${formulaText(estimate.formula)}`,
          `关键假设：${assumptionsText(estimate.assumptions)}。`,
          `置信度：${confidenceText(estimate.confidence)}。`,
          `用量边界：${label(estimate.boundary)} 这不是固定轮数保底，正式报价和开通超额付费前需要客户确认。`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.ipd_readiness_review",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_ipd_readiness_review"),
    compose: ({ toolResults }) => {
      const review = readData(toolResults, "cloud_ipd_readiness_review", "ipd_readiness");
      if (!review) return null;
      const checkpoints = readArray(review.checkpoints);
      const blockers = readArray(review.blockers);
      const productName = label(readPath(review, ["product", "product_name"]) ?? "云商品");
      return {
        answer: [
          `结论：${productName} 上架就绪度约 ${numberText(review.readiness_score)}%，当前状态为「${label(review.overall_status)}」。`,
          "",
          "IPD 检查点：",
          ...checkpoints.map((item, index) => `${index + 1}. ${label(item.stage)} - ${label(item.checkpoint_name)}：${label(item.status_label ?? item.status)}；负责人 ${label(item.owner ?? item.owner_team)}；缺口 ${label(item.gap ?? "暂无")}；下一步 ${label(item.next_action)}。`),
          "",
          `阻塞项：${blockers.length ? blockers.map((item) => `${label(item.checkpoint_name)}（${label(item.owner ?? item.owner_team)}）`).join("、") : "暂无"}`,
          "下一步：先完成财务毛利底线、SRE/运维口径、法务边界和 GTM ready，所有上架动作只生成草稿/审批摘要，人工确认后再进入生产。",
          "证据来源：IPD 检查点、发布申请、流程任务、风险信号、来源引用。",
          `demo/mock 数据边界：${label(review.data_boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.gtm_package_draft",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_gtm_package_draft"),
    compose: ({ toolResults }) => {
      const gtm = readData(toolResults, "cloud_gtm_package_draft", "gtm_package");
      if (!gtm) return null;
      const productName = label(readPath(gtm, ["product", "product_name"]) ?? "云商品");
      return {
        answer: [
          `结论：已生成 ${productName} 的 GTM 包草稿，目标客户为 ${label(gtm.industry)}。`,
          "",
          "销售材料：",
          ...readArray(gtm.assets).map((item, index) => `${index + 1}. ${label(item.title)}：面向 ${label(item.audience)}；状态 ${label(item.status)}；重点 ${label(item.content)}。`),
          "",
          `不可承诺项：${readStringArray(gtm.not_to_commit).join("、") || "正式报价、固定库存、固定交付日期和未经审批折扣均不能承诺"}`,
          "正式报价前检查：",
          ...readStringArray(gtm.quote_checklist).map((item) => `- ${item}`),
          `报价边界：${label(gtm.boundary)}`,
          `置信度：${confidenceText(gtm.confidence)}。`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.capacity_risk_review",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_capacity_risk_review"),
    compose: ({ toolResults }) => {
      const review = readData(toolResults, "cloud_capacity_risk_review", "capacity_review");
      if (!review) return null;
      return {
        answer: [
          `结论：ECS GPU 容量总体状态为「${label(review.overall_status)}」，新加坡需要容量预约和限售，华东 1 可灰度开放但需安全缓冲。`,
          "",
          "地域容量：",
          ...readArray(review.capacity_pools).map((item, index) => `${index + 1}. ${label(item.region_name)}：可用 GPU 卡 ${numberText(item.available_gpu_cards)}，峰值覆盖率 ${confidenceText(item.peak_commitment_ratio)}，健康度 ${label(item.health_status)}；销售策略：${label(item.sales_policy)}。`),
          "",
          "发布/销售限制：",
          ...readStringArray(review.sales_restrictions).map((item) => `- ${item}`),
          "下一步：",
          ...readStringArray(review.next_actions).map((item) => `- ${item}`),
          `数据边界：${label(review.boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.gmv_target_briefing",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_gmv_target_briefing"),
    compose: ({ toolResults }) => {
      const briefing = readData(toolResults, "cloud_gmv_target_briefing", "gmv_briefing");
      if (!briefing) return null;
      const risks = readArray(briefing.top_risks);
      const productName = label(readPath(briefing, ["product", "product_name"]) ?? "云商品");
      return {
        answer: [
          `结论：${productName} 本月 GMV 目标 ${currency(briefing.target_cny)}，已成交 ${currency(briefing.booked_cny)}，达成率 ${confidenceText(briefing.target_attainment_rate)}，目标缺口 ${currency(briefing.gap_to_target_cny)}。`,
          `经营健康度：净收入 ${currency(briefing.net_revenue_cny)}；毛利率 ${confidenceText(briefing.gross_margin_rate)}；延期订单 ${numberText(briefing.delayed_orders)}；容量/队列健康度 ${confidenceText(briefing.capacity_health)}；用量告警 ${numberText(briefing.usage_alerts)}。`,
          "",
          "风险排序：",
          ...risks.slice(0, 5).map((risk, index) => `${index + 1}. ${label(risk.title ?? risk.risk_name)}；负责人 ${label(risk.owner ?? risk.owner_team)}；建议 ${listText(risk.recommended_actions)}。`),
          ...(readStringArray(briefing.cost_risk_items).length ? ["", "成本/毛利关注项:", ...readStringArray(briefing.cost_risk_items).map((item) => `- ${item}`)] : []),
          "",
          "重点商机：",
          ...readArray(briefing.opportunities).slice(0, 4).map((item, index) => `${index + 1}. ${label(item.customer_name)}：预算 ${currency(item.budget_cny)}，加权商机 ${currency(item.weighted_pipeline_cny)}，阻塞 ${label(item.blockers)}。`),
          "",
          "下一步动作：",
          ...readStringArray(briefing.next_actions).map((item) => `- ${item}`),
          "证据来源：经营指标、销售商机、风险信号、运维事件、来源引用。",
          `demo/mock 数据边界：${label(briefing.data_boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.ops_incident_business_impact",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_ops_incident_business_impact"),
    compose: ({ toolResults }) => {
      const impact = readData(toolResults, "cloud_ops_incident_business_impact", "ops_impact");
      if (!impact) return null;
      const incident = toRecord(impact.incident) ?? {};
      const summary = toRecord(impact.impact_summary) ?? {};
      return {
        answer: [
          `结论：${label(incident.title)}，预计延期 ${numberText(summary.delay_hours)} 小时，影响 GMV ${currency(summary.impact_gmv_cny)}，收入确认风险 ${currency(summary.revenue_recognition_risk_cny)}。`,
          `影响客户/订单：客户 ${readArray(impact.affected_customers).map((item) => label(item.customer_name)).join("、") || "待确认"}；订单 ${readArray(impact.affected_orders).map((item) => label(item.order_id)).join("、") || "待确认"}。`,
          `客户影响：${label(summary.customer_impact)}`,
          "",
          "处理动作：",
          ...readStringArray(impact.next_actions).map((item) => `- ${item}`),
          "",
          "客户沟通草稿：",
          ...readStringArray(impact.customer_message_draft).map((item) => `- ${item}`),
          `回滚检查点：${label(impact.rollback_plan)}`,
          `数据边界：${label(impact.data_boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.ops_degradation_plan",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_ops_degradation_plan"),
    compose: ({ toolResults }) => {
      const plan = readData(toolResults, "cloud_ops_degradation_plan", "degradation_plan");
      if (!plan) return null;
      const productName = label(readPath(plan, ["product", "product_name"]) ?? "云商品");
      return {
        answer: [
          `结论：${productName} 当前应按“高峰保护/事故降级”处理，所有对外动作只生成降级草稿和沟通口径，不自动改变生产配置。`,
          "",
          "触发条件：",
          ...readStringArray(plan.trigger_conditions).map((item) => `- ${item}`),
          "",
          "商品页降级：",
          ...readStringArray(plan.product_page_degradation).map((item) => `- ${item}`),
          "",
          "销售话术降级：",
          ...readStringArray(plan.sales_talk_degradation).map((item) => `- ${item}`),
          "",
          "SRE 告警与销售通知：",
          ...readStringArray(plan.sre_alerts).map((item) => `- ${item}`),
          ...readStringArray(plan.sales_notifications).map((item) => `- ${item}`),
          "",
          "客服通知：",
          ...readStringArray(plan.customer_support_notice).map((item) => `- ${item}`),
          `回滚检查点：${readStringArray(plan.rollback_checkpoints).join("；")}`,
          `数据边界：${label(plan.data_boundary)}`,
          "证据来源：风险信号、流程任务、GTM 材料、演示假设。"
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.agent_plan_overage_policy",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_agent_plan_overage_policy"),
    compose: ({ toolResults }) => {
      const policy = readData(toolResults, "cloud_agent_plan_overage_policy", "overage_policy");
      if (!policy) return null;
      return {
        answer: [
          `结论：${label(policy.conclusion)}`,
          "",
          `确认人：${label(policy.confirmation_owner)}。`,
          "确认流程：",
          ...readStringArray(policy.confirmation_steps).map((item) => `- ${item}`),
          "",
          "账单提示：",
          ...readStringArray(policy.bill_notice).map((item) => `- ${item}`),
          "",
          "销售边界：",
          ...readStringArray(policy.sales_boundary).map((item) => `- ${item}`),
          `数据边界：${label(policy.data_boundary)}`,
          "证据来源：回答策略样例、用量估算器、风险信号、演示假设。"
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.retrospective_template",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_retrospective_template"),
    compose: ({ toolResults }) => {
      const template = readData(toolResults, "cloud_retrospective_template", "retrospective_template");
      if (!template) return null;
      const productName = label(readPath(template, ["product", "product_name"]) ?? "云商品");
      return {
        answer: [
          `结论：已把 ${productName} 从上架、销售、交付和经营风险复盘成下一次可复用模板。该结果是演示草稿，不执行生产变更。`,
          "",
          "商品上架检查模板：",
          ...readStringArray(template.product_launch_checklist).map((item) => `- ${item}`),
          "",
          "客户成功检查模板：",
          ...readStringArray(template.customer_success_checklist).map((item) => `- ${item}`),
          "",
          `可复用 checkpoint：${readStringArray(template.reusable_checkpoints).join("、")}`,
          `数据边界：${label(template.data_boundary)}`,
          "证据来源：IPD 检查点、风险信号、流程任务、GTM 材料、演示假设。"
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.release_risk_review",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_release_risk_review"),
    compose: ({ toolResults }) => {
      const report = readData(toolResults, "cloud_release_risk_review", "risk_report");
      if (!report) return null;
      const risks = readArray(report.risk_items);
      const tasks = readArray(report.blocking_tasks);
      const approvals = readArray(report.approval_tasks);
      const lines = [
        `结论：本次发布总体风险为「${label(report.risk_level)}」，${report.requires_human_review === true ? "需要人工复核后再进入生产流程。" : "完成检查后可继续推进。"}`,
        "",
        "风险排序：",
        ...risks.slice(0, 5).map((risk, index) => `${index + 1}. ${label(risk.title ?? risk.risk_name ?? "发布风险")}；严重度 ${label(risk.severity ?? risk.risk_level)}；负责人 ${label(risk.owner ?? risk.owner_user_id ?? risk.owner_team)}；建议 ${listText(risk.recommended_actions) || "补齐证据后复核"}。`),
        ...(!risks.length ? ["1. 暂未发现明确风险项，但仍需完成发布前检查。"] : []),
        "",
        "流程阻塞：",
        ...tasks.slice(0, 5).map((task, index) => `${index + 1}. ${label(task.task_name ?? task.step)}；负责人 ${label(task.owner ?? task.owner_user_id ?? task.owner_team)}；状态 ${label(task.status)}；${task.delay_hours !== undefined ? `已延期 ${task.delay_hours} 小时；` : ""}${label(task.blocker_reason ?? "需要明确处理动作")}。`),
        ...(!tasks.length ? ["1. 暂无已延期阻塞项。"] : []),
        "",
        `审批任务：${approvals.length ? approvals.map((item) => `${label(item.approval_name ?? item.task_name ?? item.step)}（${label(item.status)}）`).join("、") : "暂无审批任务样本"}`,
        `回滚检查点：${label(report.rollback_plan)}`,
        "下一步：由商品平台、财务、法务/SRE 人工确认风险、价格、合同影响和回滚检查点后，再进入正式审批。",
        "证据来源：发布申请、风险信号、流程任务、审批任务、来源引用。"
      ];
      return { answer: lines.join("\n"), artifacts: [] };
    }
  },
  {
    id: "cloud.approval_summary",
    matches: ({ toolResults }) => hasTool(toolResults, "create_cloud_approval_summary"),
    compose: ({ toolResults }) => {
      const summary = readData(toolResults, "create_cloud_approval_summary", "approval_summary");
      if (!summary) return null;
      const approvals = readArray(summary.approval_tasks);
      const blockers = readArray(summary.blocking_tasks);
      const notices = readStringArray(summary.customer_support_notice);
      return {
        answer: [
          `结论：已生成「${label(summary.title)}」发布审批摘要草稿，建议决策为「${label(summary.recommended_decision)}」。所有动作只生成草稿/审批摘要，不会真实变更生产状态。`,
          "",
          `风险等级：${label(summary.risk_level)}；人审要求：${summary.human_review_required === true ? "需要人工复核" : "检查完成后可继续"}。`,
          `回滚检查点：${label(summary.rollback_checkpoint)}。`,
          "",
          "审批任务：",
          ...(approvals.length ? approvals.map((item, index) => `${index + 1}. ${label(item.approver_role ?? item.approval_name ?? "审批人")}：${label(item.status)}；${label(item.reason ?? "等待审批确认")}。`) : ["1. 暂无审批任务样本。"]),
          "",
          "阻塞项：",
          ...(blockers.length ? blockers.map((item, index) => `${index + 1}. ${label(item.step ?? item.task_name)}；负责人 ${label(item.owner ?? item.owner_user_id ?? item.owner_team)}；${label(item.blocker_reason ?? "需要明确处理动作")}。`) : ["1. 暂无阻塞项。"]),
          "",
          "客服通知：",
          ...(notices.length ? notices.map((item) => `- ${item}`) : ["- 若进入灰度或延期，请客服说明当前为演示/估算口径，正式价格、产能和交付窗口需人工确认。"]),
          "下一步：由商品平台、财务、法务/SRE 和销售共同确认风险、价格、合同影响、客服通知和回滚检查点后，再进入正式审批。",
          "证据来源：发布申请、审批任务、流程任务、风险信号。"
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.solution_recommendation",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_solution_recommendation"),
    compose: ({ toolResults }) => {
      const solution = readData(toolResults, "cloud_solution_recommendation", "solution");
      if (!solution) return null;
      const plan = readArray(solution.package_plan);
      const productNames = plan.map((item) => label(item.product_name ?? item.product_code)).filter((item) => item && item !== "-");
      const infra = productNames.some((item) => /ECS|GPU|RDS|CLB|数据库|负载均衡/i.test(item));
      return {
        answer: [
          `推荐方案：按 ${label(solution.industry ?? "客户行业")}、预算 ${currency(solution.budget_cny)}，建议组合 ${productNames.join(" + ") || "云商品套餐"}。`,
          "",
          "预算拆分：",
          ...plan.map((item, index) => `${index + 1}. ${label(item.product_name ?? item.product_code)}：预算 ${currency(item.budget_cny)}；${label(item.reason)}。`),
          "",
          infra
            ? "组合理由：ECS GPU 承担训练和核心计算，RDS 承载业务数据库，TOS 保存训练数据、模型产物和审计材料，CLB 支撑业务入口和流量调度。"
            : "组合理由：Seedance 承担视频生成主链路，Agent Plan 承接客服和运营问答，TOS 保存素材/成片/知识库，CDN 支撑分发和峰值访问。",
          `关键假设：${readStringArray(solution.assumptions).join("；") || "预算拆分采用 demo 估算，未包含真实合同底价、专项促销和客户私有折扣。"}`,
          `报价边界：${label(solution.boundary ?? "这是销售测算草稿，不是正式报价、固定库存、固定交付日期或 SLA 承诺。")}`,
          `置信度：${confidenceText(solution.confidence)}。正式报价前需要复核合同折扣、地域容量、资源包、内容安全或 SLA/审计要求。`
        ].join("\n"),
        artifacts: []
      };
    }
  },
  {
    id: "cloud.self_service_quote",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_self_service_quote"),
    compose: ({ toolResults }) => {
      const quote = readData(toolResults, "cloud_self_service_quote", "quote");
      if (!quote) return null;
      const seedance = readPath(quote, ["seedance", "data", "estimate"]) as JsonObject | undefined;
      const agentPlan = readPath(quote, ["agent_plan", "data", "estimate"]) as JsonObject | undefined;
      const lines = [
        "自助询价结论：",
        `- Seedance：估算可生成 ${numberText(seedance?.estimated_video_seconds ?? seedance?.estimated_seconds)} 秒，约 ${numberText(seedance?.estimated_video_count)} 条视频。`,
        `- Agent Plan Medium：估算可支持 ${numberText(agentPlan?.estimated_rounds)} 轮对话，单轮约 ${numberText(agentPlan?.estimated_afp_per_round)} AFP。`,
        "",
        `Seedance 公式：${formulaText(seedance?.formula)}`,
        `Agent Plan 公式：${formulaText(agentPlan?.formula)}`,
        `关键假设：Seedance ${assumptionsText(seedance?.assumptions)}；Agent Plan ${assumptionsText(agentPlan?.assumptions)}。`,
        `置信度：Seedance ${confidenceText(seedance?.confidence)}；Agent Plan ${confidenceText(agentPlan?.confidence)}。`,
        `报价边界：${label(quote.disclaimer ?? seedance?.boundary ?? agentPlan?.boundary ?? "自助询价仅用于预算沟通，不是正式报价或固定产能承诺。")}`
      ];
      return { answer: lines.join("\n"), artifacts: [] };
    }
  },
  {
    id: "cloud.executive_briefing",
    matches: ({ toolResults }) => hasTool(toolResults, "cloud_executive_briefing"),
    compose: ({ toolResults }) => {
      const briefing = readData(toolResults, "cloud_executive_briefing", "executive_briefing");
      if (!briefing) return null;
      const risks = readArray(briefing.top_risks);
      const tasks = readArray(briefing.blocking_tasks);
      const renewals = readArray(briefing.renewal_risks);
      return {
        answer: [
          `结论：${label(briefing.conclusion)}`,
          `影响金额/客户：续约风险金额 ${currency(briefing.amount_at_risk_cny)}；重点客户 ${renewals.map((item) => label(item.customer_name ?? item.customer_id)).filter(Boolean).join("、") || "暂无明确客户样本"}。`,
          "",
          "风险排序：",
          ...risks.slice(0, 5).map((risk, index) => `${index + 1}. ${label(risk.title ?? risk.risk_name ?? risk.message)}；负责人 ${label(risk.owner ?? risk.owner_user_id ?? risk.owner_team)}；影响 ${impactText(risk)}。`),
          "",
          "流程阻塞：",
          ...tasks.slice(0, 5).map((task, index) => `${index + 1}. ${label(task.task_name ?? task.step)}；负责人 ${label(task.owner ?? task.owner_user_id ?? task.owner_team)}；${task.delay_hours !== undefined ? `已延期 ${task.delay_hours} 小时` : label(task.status)}。`),
          "",
          "续约风险：",
          ...(renewals.length ? renewals.slice(0, 5).map((item, index) => `${index + 1}. ${label(item.customer_name ?? item.customer_id)}；金额 ${currency(item.arr_at_risk_cny ?? item.current_arr_cny)}；续约概率 ${confidenceText(item.renewal_probability)}；负责人 ${label(item.owner ?? item.owner_user_id ?? item.owner_team)}；下一步 ${label(item.next_action ?? item.recommended_action ?? "请销售和客户成功跟进合同复核") }。`) : ["1. 暂无明确续约风险样本。"]),
          "",
          "下一步动作：",
          ...readStringArray(briefing.next_actions).slice(0, 5).map((item) => `- ${label(item)}`),
          "证据来源：经营指标、风险信号、流程任务、续约机会、来源引用。",
          `demo/mock 数据边界：${label(briefing.data_boundary)}`
        ].join("\n"),
        artifacts: []
      };
    }
  }
];

function hasTool(results: ToolResult[], expected: string): boolean {
  return results.some((result) => normalizeTool(result.tool) === expected || normalizeTool(readPath(result, ["data", "tool"])) === expected);
}

function readData(results: ToolResult[], expected: string, key: string): JsonObject | null {
  const result = results.find((item) => normalizeTool(item.tool) === expected || normalizeTool(readPath(item, ["data", "tool"])) === expected);
  const data = toRecord(result?.data);
  const unwrapped = toRecord(data?.data) ?? data;
  return toRecord(unwrapped?.[key]);
}

function normalizeTool(value: unknown): string {
  return String(value ?? "").replace(/^tool\./, "");
}

function toRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function readArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(toRecord).filter((item): item is JsonObject => Boolean(item)) : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => label(item)).filter(Boolean) : [];
}

function readPath(value: unknown, path: string[]): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function label(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map(label).join("、");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).slice(0, 4).map(([key, item]) => `${fieldLabel(key)}：${label(item)}`).join("；");
  const raw = String(value);
  const map: Record<string, string> = {
    high: "高",
    medium: "中",
    low: "低",
    blocked: "已阻塞",
    in_progress: "处理中",
    completed: "已完成",
    finance: "财务团队",
    legal: "法务团队",
    sales: "销售团队",
    product: "商品产品团队",
    cloud_product: "商品产品团队",
    finance_reviewer_001: "财务复核负责人",
    legal_001: "法务审核负责人",
    sales_ai_001: "AI 内容客户销售负责人",
    sales_media_001: "媒体客户销售负责人",
    cloud_sales_001: "陆衡",
    cloud_sales_002: "金融行业销售负责人",
    cloud_pm_001: "程一川",
    sre_seedance_001: "Seedance 运维负责人",
    sre_agent_001: "Agent Plan 运维负责人",
    cloud_sre_001: "SRE 运维负责人",
    cloud_gtm_001: "GTM 负责人",
    cloud_finance_001: "财务审批负责人",
    ai_business: "AI 商品经营团队",
    cloud_business: "云业务经营团队",
    agent_with_search: "带搜索工具的智能体对话",
    sku_agent_plan_medium: "Agent Plan Medium 套餐",
    model_pricing_review: "模型价格复核",
    afp_rule_finance_review: "AFP 计费规则财务复核",
    price_discount_guardrail: "价格与折扣护栏",
    traffic_ramp_limit: "流量灰度与限流策略",
    content_safety_terms: "内容安全条款审核",
    legal_terms_review: "法务条款审核",
    sre: "SRE 运维团队",
    risk: "风险",
    watch: "关注",
    target: "目标",
    normal: "正常",
    ready: "就绪",
    draft: "草稿",
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
    active: "生效中",
    pending: "待处理",
    waiting: "等待处理",
    mitigating: "处理中",
    in_review: "复核中",
    needs_product_definition: "需要补齐产品定义",
    needs_entitlement_governance: "需要权益治理",
    blocked_by_capacity_and_margin: "被容量和毛利门禁阻塞",
    ready_with_warnings: "可发布但需提示风险",
    blocked_by_entitlement: "被权益规则阻塞",
    requires_finance_review: "需要财务复核",
    needs_sre_gate: "需要 SRE 门禁确认",
    "720p_standard": "720P 标准质量",
    "720p_high": "720P 高质量",
    "1080p_standard": "1080P 标准质量",
    "1080p_high": "1080P 高质量",
    hold_for_review: "先暂停并复核"
  };
  return formulaText(map[raw] ?? raw)
    .replace(/\bowner_user_id\b/g, "负责人")
    .replace(/\bowner_team\b/g, "负责团队")
    .replace(/\bcloud_[a-z_]+\b/g, "业务数据");
}

function fieldLabel(key: string): string {
  const map: Record<string, string> = {
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
  return map[key] ?? key;
}

function formulaText(value: unknown): string {
  return String(value ?? "-")
    .replace(/\*/g, "×")
    .replace(/\bbudget\b/g, "预算")
    .replace(/\bstorage_cdn_cost\b/g, "存储和分发预估成本")
    .replace(/\bdiscount\b/g, "合同折扣")
    .replace(/\bprice_per_1k_tokens\b/g, "千 token 价格")
    .replace(/\btoken_per_second\b/g, "每秒 token 消耗")
    .replace(/\bafp_quota\b/g, "AFP 套餐额度")
    .replace(/\bextra_budget\b/g, "追加预算")
    .replace(/\boverage_price\b/g, "超额单价")
    .replace(/\bsafety_buffer\b/g, "安全缓冲")
    .replace(/\bturn_afp\b/g, "每轮 AFP 消耗")
    .replace(/\bretry\b/g, "重试损耗")
    .replace(/\bmoderation\b/g, "内容安全审核损耗")
    .replace(/\bsafety\b/g, "安全余量");
}

function assumptionsText(value: unknown): string {
  const record = toRecord(value);
  if (!record) return "-";
  return Object.entries(record).slice(0, 4).map(([key, item]) => `${fieldLabel(key)} ${label(item)}`).join("，");
}

function listText(value: unknown): string {
  return Array.isArray(value) ? value.map(label).join("、") : label(value);
}

function numberText(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString("zh-CN") : "-";
}

function confidenceText(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "需要人工复核";
}

function currency(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n).toLocaleString("zh-CN")} 元` : "-";
}

function impactText(row: JsonObject): string {
  if (row.impact_amount_cny !== undefined) return currency(row.impact_amount_cny);
  if (row.arr_at_risk_cny !== undefined) return `续约风险金额 ${currency(row.arr_at_risk_cny)}`;
  if (row.impacted_customers !== undefined) return `影响客户 ${label(row.impacted_customers)}`;
  return "需要业务复核";
}

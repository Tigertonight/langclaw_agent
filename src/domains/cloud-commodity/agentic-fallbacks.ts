import type { AgenticFallbackDefinition } from "../types.js";

type ObservationView = {
  call: { tool_name: string; args: Record<string, unknown> };
  answer?: string;
  observation?: Record<string, unknown>;
};

function budgetCny(text: string): number | undefined {
  const wan = text.match(/(\d+(?:\.\d+)?)\s*万(?:元|块|预算)?/);
  if (wan) return Number(wan[1]) * 10000;
  const yuan = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|CNY|RMB)/i);
  return yuan ? Number(yuan[1]) : undefined;
}

function productCode(text: string): string {
  if (/Seedance|视频生成|视频模型/i.test(text)) return "SEEDANCE";
  if (/Agent\s*Plan|智能体套餐|AFP/i.test(text)) return "AGENT_PLAN";
  if (/GPU|云服务器|训练实例|ECS/i.test(text)) return "ECS";
  if (/TOS|OSS|对象存储/i.test(text)) return "TOS";
  if (/CDN/i.test(text)) return "CDN";
  return "SEEDANCE";
}

function productTitle(code: string): string {
  if (code === "AGENT_PLAN") return "Agent Plan";
  if (code === "SEEDANCE") return "Seedance Mini";
  if (code === "ECS") return "ECS GPU";
  if (code === "TOS") return "TOS 对象存储";
  if (code === "CDN") return "CDN";
  return "云商品";
}

function releaseRequestId(text: string): string {
  return text.match(/rel_[a-z0-9_]+/i)?.[0]
    ?? (/ECS|GPU|云服务器|训练实例/i.test(text)
      ? "rel_ecs_gpu_train_202606"
      : /Agent\s*Plan|智能体套餐|AFP/i.test(text)
        ? "rel_agent_plan_enterprise_202606"
        : "rel_seedance_mini_selfserve_202606");
}

function readData<T = Record<string, unknown>>(item: ObservationView, key: string): T | null {
  const data = item.observation?.data;
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return value && typeof value === "object" ? value as T : null;
}

function listNames(rows: unknown, field: string, limit = 4): string {
  if (!Array.isArray(rows)) return "";
  return rows.slice(0, limit).map((row) => {
    if (!row || typeof row !== "object") return "";
    return String((row as Record<string, unknown>)[field] ?? "");
  }).filter(Boolean).join("、");
}

function composeProductDraft(item: ObservationView): string {
  const draft = readData<Record<string, unknown>>(item, "draft");
  if (!draft) return "已调用云商品建模工具，但没有拿到可展示草稿。";
  const product = draft.product as Record<string, unknown> | undefined;
  return [
    `结论：已生成 ${String(product?.product_name ?? "云产品")} 的商品化草稿，当前结果是 demo/草稿，不代表正式上架生效。`,
    "",
    `商品模型：Product=${String(product?.product_id ?? "")}，Provider=${String(product?.provider ?? "demo provider")}，品类=${String(product?.product_category ?? "")}。`,
    `Offer/SKU：已整理 ${Array.isArray(draft.offers) ? draft.offers.length : 0} 个 Offer、${Array.isArray(draft.skus) ? draft.skus.length : 0} 个 SKU。`,
    `计费项：${listNames(draft.meters, "meter_name") || "需人工补齐计费项"}`,
    `购买页字段：${listNames(draft.purchase_page_fields, "label", 8) || "地域、计费模式、规格/SKU"}`,
    `待补字段：${Array.isArray(draft.missing_fields) ? draft.missing_fields.join("、") : "无"}`,
    "",
    "下一步动作：产品经理确认规格和地域；计费/财务复核价格和资源包；法务/风控复核内容安全与合同边界；发布前生成审批摘要和回滚检查点。",
  ].join("\n");
}

function composeExecutiveBriefing(item: ObservationView): string {
  const briefing = readData<Record<string, unknown>>(item, "executive_briefing");
  if (!briefing) return "已调用云商品经营简报工具，但没有拿到可展示数据。";
  const risks = Array.isArray(briefing.top_risks) ? briefing.top_risks : [];
  const tasks = Array.isArray(briefing.blocking_tasks) ? briefing.blocking_tasks : [];
  const renewals = Array.isArray(briefing.renewal_risks) ? briefing.renewal_risks : [];
  const snapshot = briefing.operating_snapshot as Record<string, unknown> | undefined;
  const topRisk = risks[0] as Record<string, unknown> | undefined;
  const topTask = tasks[0] as Record<string, unknown> | undefined;
  const topRenewal = renewals[0] as Record<string, unknown> | undefined;
  const nextActions = Array.isArray(briefing.next_actions) && briefing.next_actions.length
    ? briefing.next_actions.map((action, index) => `${index + 1}. ${String(action)}`)
    : [
        "1. 请财务复核负责人今天内补齐价格证据和毛利测算，解除发布阻塞。",
        "2. 请销售团队优先跟进续约风险金额较高的客户，形成合同复核和客户沟通清单。",
        "3. 请商品产品团队把价格、发布和促销动作收敛为草稿/审批摘要，人工确认后再进入生产流程。",
      ];
  return [
    `结论：${String(briefing.conclusion ?? "云商品平台需要优先处理风险和阻塞事项。")}`,
    "",
    `经营指标：GMV ${String(snapshot?.gmv_mtd_cny ?? "待查")} 元，净收入 ${String(snapshot?.net_revenue_mtd_cny ?? "待查")} 元，毛利率 ${String(snapshot?.gross_margin_rate ?? "待查")}，活跃付费客户 ${String(snapshot?.active_paying_customers ?? "待查")} 个，账单争议 ${String(snapshot?.bill_dispute_amount_cny ?? "待查")} 元。`,
    "数据边界：上述经营指标来自 demo/mock 演示用经营指标样本，用于售卖演示和链路验证，不能表述为云厂商官方经营披露或正式销售承诺。",
    `1. 最高风险：${String(topRisk?.title ?? topRisk?.risk_name ?? topRisk?.risk_signal_id ?? "暂无高风险")}；负责人 ${String(topRisk?.owner ?? "待明确")}；影响客户 ${Array.isArray(topRisk?.impacted_customers) ? topRisk?.impacted_customers.join("、") : "待确认"}。`,
    `2. 流程阻塞：${String(topTask?.task_name ?? topTask?.workflow_task_id ?? "暂无阻塞任务")}；负责人 ${String(topTask?.owner ?? "待明确")}；延期 ${String(topTask?.delay_hours ?? 0)} 小时。`,
    `3. 续约风险：${String(topRenewal?.customer_name ?? topRenewal?.customer_id ?? "暂无重点客户")}；风险金额 ${String(topRenewal?.arr_at_risk_cny ?? 0)} 元；负责人 ${String(topRenewal?.owner ?? "待明确")}。`,
    "",
    `影响金额：${String(briefing.amount_at_risk_cny ?? 0)} 元。`,
    `负责人：${Array.isArray(briefing.owners) ? briefing.owners.join("、") : "待明确"}。`,
    "",
    "下一步动作：",
    ...nextActions,
    "证据来源：经营指标、风险信号、流程任务、续约机会、来源引用。",
  ].join("\n");
}

function composeSolution(item: ObservationView): string {
  const solution = readData<Record<string, unknown>>(item, "solution");
  if (!solution) return "已调用云商品方案推荐工具，但没有拿到可展示方案。";
  const plan = Array.isArray(solution.package_plan) ? solution.package_plan : [];
  const lines = plan.map((row) => {
    const item = row as Record<string, unknown>;
    return `- ${String(item.product_name ?? item.product_code)}：预算 ${String(item.budget_cny)} 元，${String(item.reason)}`;
  });
  const productNames = plan.map((row) => {
    const record = row as Record<string, unknown>;
    return String(record.product_name ?? record.product_code ?? "");
  }).filter(Boolean);
  const infra = productNames.some((name) => /ECS|RDS|CLB|GPU|数据库|负载均衡/i.test(name));
  return [
    `推荐方案：按 ${String(solution.industry ?? "客户行业")}、预算 ${String(solution.budget_cny ?? "")} 元，建议组合 ${productNames.join(" + ") || "云商品套餐"}。`,
    "",
    ...lines,
    "",
    infra
      ? "为什么这样配：ECS GPU 承担训练和核心计算，RDS 承载业务数据库，TOS 保存训练数据和审计材料，CLB 支撑业务入口和访问调度。"
      : "为什么这样配：Seedance 负责视频生成主链路；Agent Plan 承接智能客服和运营助手；TOS 保存素材、成片和知识库；CDN 支撑分发与访问峰值。",
    `关键假设：${Array.isArray(solution.assumptions) ? solution.assumptions.join("；") : "预算拆分采用 demo 估算，未包含真实合同底价、专项促销和客户私有折扣。"}`,
    `报价边界：${String(solution.boundary ?? "这是销售测算草稿，不是正式报价或固定产能承诺。")}`,
    `置信度：${String(solution.confidence ?? 0.68)}。正式报价需复核合同折扣、地域、资源包、内容安全和峰值带宽。`,
  ].join("\n");
}

function composeQuote(item: ObservationView): string {
  const quote = readData<Record<string, unknown>>(item, "quote");
  if (!quote) return "已调用自助询价工具，但没有拿到可展示估算。";
  const seedance = ((quote.seedance as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)?.estimate as Record<string, unknown> | undefined;
  const agentPlan = ((quote.agent_plan as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)?.estimate as Record<string, unknown> | undefined;
  return [
    "自助询价结论：",
    `- Seedance：预算 ${String(seedance?.budget_cny ?? "")} 元，${String(seedance?.quality ?? "720p_standard")} 估算可生成 ${String(seedance?.estimated_video_seconds ?? "")} 秒，约 ${String(seedance?.estimated_video_count ?? "")} 条 ${String(seedance ? 5 : "")} 秒视频。`,
    `- Agent Plan：${String(agentPlan?.recommended_plan ?? "agent_plan_medium")} 估算可支持 ${String(agentPlan?.estimated_rounds ?? "")} 轮对话，单轮约 ${String(agentPlan?.estimated_afp_per_round ?? "")} AFP。`,
    "",
    `Seedance 公式：${String(seedance?.formula ?? "")}`,
    `Agent Plan 公式：${String(agentPlan?.formula ?? "")}`,
    `置信度：Seedance ${String(seedance?.confidence ?? "")}；Agent Plan ${String(agentPlan?.confidence ?? "")}。`,
    `边界：${String(quote.disclaimer ?? "自助询价仅用于预算沟通，正式报价需复核合同、地域、资源包和实际调用形态。")}`,
  ].join("\n");
}

function composeNamedReport(item: ObservationView, key: string, title: string): string {
  const data = readData<Record<string, unknown>>(item, key);
  if (!data) return `已调用${title}工具，但没有拿到可展示数据。`;
  const nextActions = readStringList(data.next_actions).slice(0, 5);
  const risks = readObjectList(data.top_risks ?? data.risks ?? data.risk_items).slice(0, 5);
  const tasks = readObjectList(data.blocking_tasks ?? data.tasks ?? data.workflow_tasks).slice(0, 5);
  const checkpoints = readObjectList(data.checkpoints ?? data.deliverables ?? data.rules ?? data.channels ?? data.gates ?? data.relation_rows ?? data.capacity_pools ?? data.assets ?? data.opportunities).slice(0, 6);
  return [
    `结论：已生成${title}。以下内容来自演示数据和估算假设，不代表正式价格、库存、SLA 或生产变更。`,
    "",
    ...(checkpoints.length ? ["业务明细：", ...checkpoints.map((row, index) => `${index + 1}. ${friendlyValue(row.checkpoint_name ?? row.name ?? row.entitlement_name ?? row.channel ?? row.gate_name ?? row.offer_name ?? row.title ?? row.region_name ?? row.customer_name ?? row.metric_name ?? row.task_name ?? "检查项")}：${friendlyValue(row.status_label ?? row.status ?? row.publication_status ?? row.risk_level ?? row.health_status ?? row.reason ?? row.content ?? row.blockers ?? row.gap ?? row.precheck ?? "需要复核")}；负责人 ${friendlyValue(row.owner ?? row.owner_team ?? row.owner_user_id ?? "待明确")}。`), ""] : []),
    ...(risks.length ? ["风险排序：", ...risks.map((row, index) => `${index + 1}. ${friendlyValue(row.title ?? row.risk_name ?? row.message ?? "风险项")}；负责人 ${friendlyValue(row.owner ?? row.owner_team ?? row.owner_user_id ?? "待明确")}；建议 ${friendlyValue(row.recommended_actions ?? row.next_action ?? "补齐证据后复核")}。`), ""] : []),
    ...(tasks.length ? ["流程阻塞：", ...tasks.map((row, index) => `${index + 1}. ${friendlyValue(row.task_name ?? row.step ?? "流程任务")}；负责人 ${friendlyValue(row.owner ?? row.owner_team ?? row.owner_user_id ?? "待明确")}；${friendlyValue(row.blocker_reason ?? row.status ?? "需要处理")}。`), ""] : []),
    ...(nextActions.length ? ["下一步动作：", ...nextActions.map((action) => `- ${action}`)] : ["下一步动作：请对应负责人按检查点完成财务、SRE、法务和销售确认；所有价格、发布、折扣和上架动作均需人工确认后才可进入生产流程。"]),
    "",
    "证据来源：IPD 检查点、GTM 材料、容量池、经营指标、销售商机、运维事件、来源引用。"
  ].join("\n");
}

function composeApprovalSummary(item: ObservationView): string {
  const data = readData<Record<string, unknown>>(item, "approval_summary");
  if (!data) return "已生成发布审批摘要草稿，所有动作只生成草稿/审批摘要，不会真实变更生产状态。";
  const approvals = readObjectList(data.approval_tasks);
  const blockers = readObjectList(data.blocking_tasks);
  const notices = readStringList(data.customer_support_notice);
  return [
    `结论：已生成「${friendlyValue(data.title ?? "云商品发布") }」审批摘要草稿，建议决策为「${friendlyValue(data.recommended_decision ?? "先复核后审批")}」。所有动作只生成草稿/审批摘要，不会真实变更生产状态。`,
    `风险等级：${friendlyValue(data.risk_level ?? "需要复核")}；人审要求：${data.human_review_required === false ? "检查完成后可继续" : "需要人工复核"}。`,
    `回滚检查点：${friendlyValue(data.rollback_checkpoint ?? "发布前保留原套餐、价格和流量入口，可一键回退到上一版本")}。`,
    "",
    "审批任务：",
    ...(approvals.length ? approvals.map((row, index) => `${index + 1}. ${friendlyValue(row.approver_role ?? row.approval_name ?? "审批人")}：${friendlyValue(row.status ?? "待处理")}；${friendlyValue(row.reason ?? "等待审批确认")}。`) : ["1. 暂无审批任务样本。"]),
    "",
    "阻塞项：",
    ...(blockers.length ? blockers.map((row, index) => `${index + 1}. ${friendlyValue(row.step ?? row.task_name ?? "流程任务")}；负责人 ${friendlyValue(row.owner ?? row.owner_team ?? row.owner_user_id ?? "待明确")}；${friendlyValue(row.blocker_reason ?? "需要处理")}。`) : ["1. 暂无阻塞项。"]),
    "",
    "客服通知：",
    ...(notices.length ? notices.map((notice) => `- ${notice}`) : ["- 若进入灰度或延期，请客服说明当前为演示/估算口径，正式价格、产能和交付窗口需人工确认。"]),
    "下一步：由商品平台、财务、法务/SRE 和销售共同确认风险、价格、合同影响、客服通知和回滚检查点后，再进入正式审批。",
    "证据来源：发布申请、审批任务、流程任务、风险信号。"
  ].join("\n");
}

function readObjectList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(friendlyValue).filter(Boolean) : [];
}

function friendlyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map(friendlyValue).join("、");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).slice(0, 3).map(([key, item]) => `${friendlyKey(key)}：${friendlyValue(item)}`).join("；");
  }
  const raw = String(value);
  const map: Record<string, string> = {
    high: "高风险",
    medium: "中风险",
    low: "低风险",
    blocked: "已阻塞",
    in_progress: "处理中",
    completed: "已完成",
    draft: "草稿",
    hold_for_review: "先暂停并复核",
    cloud_product: "商品产品团队",
    finance: "财务团队",
    legal: "法务团队",
    sre: "SRE 运维团队",
    sales: "销售团队",
    finance_reviewer_001: "财务复核负责人",
    legal_001: "法务审核负责人",
    cloud_pm_001: "程一川",
    cloud_sales_001: "陆衡"
  };
  return (map[raw] ?? raw)
    .replace(/\bcloud_[a-z0-9_]+\b/g, "业务数据")
    .replace(/\bowner_user_id\b/g, "负责人")
    .replace(/\bowner_team\b/g, "负责团队")
    .replace(/\barr_at_risk_cny\b/g, "续约风险金额");
}

function friendlyKey(key: string): string {
  const map: Record<string, string> = {
    owner_user_id: "负责人",
    owner_team: "负责团队",
    status: "状态",
    risk_level: "风险等级",
    severity: "严重度",
    arr_at_risk_cny: "续约风险金额",
    delay_hours: "延期小时",
    blocker_reason: "阻塞原因"
  };
  return map[key] ?? key;
}

export const CLOUD_AGENTIC_FALLBACKS: AgenticFallbackDefinition[] = [
  {
    id: "cloud_productization_readiness_review",
    matches(message) {
      return /(产品能力|技术能力|模型能力|产品化条件|产品定义交付物|具备产品化|产品化定义|能力边界|是否.*产品化)/.test(message)
        && /(云商品|云产品|Seedance|视频生成|Agent\s*Plan|ECS|GPU|模型能力)/i.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_productization_readiness_review", args: { product_code: productCode(message) } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "productization_review", "云产品化定义评审");
    },
  },
  {
    id: "cloud_offer_design_review",
    matches(message) {
      return /(Offer|SKU|Meter|Price|售卖方式|按量.*包月|包月.*按量|几个\s*Offer|资源包.*互斥|促销.*互斥|折扣.*互斥)/i.test(message)
        && /(设计|关系|治理|能否同时存在|应该.*几个|互斥|冲突)/.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_offer_design_review", args: { product_code: productCode(message) } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "offer_design_review", "云商品 Offer 治理评审");
    },
  },
  {
    id: "cloud_plan_entitlement_review",
    matches(message) {
      return /(权益|赠送额度|每天送|每日送|过期|退订|退款|超额|二次确认|账单解释|自动扣费)/.test(message)
        && /(云商品|云产品|Agent\s*Plan|智能体套餐|AFP|会员|Seedance|资源包)/i.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_plan_entitlement_review", args: { product_code: productCode(message) } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "entitlement_review", "云套餐权益治理评审");
    },
  },
  {
    id: "cloud_channel_publication_review",
    matches(message) {
      return /(官网|控制台|销售渠道|销售报价|API|Marketplace|渠道发布|展示哪些字段|哪些不能展示|禁展示)/i.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_channel_publication_review", args: { product_code: productCode(message) } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "channel_publication_review", "云商品渠道发布评审");
    },
  },
  {
    id: "cloud_sre_launch_gate_review",
    matches(message) {
      return /(SRE|稳定性门禁|上架门禁|容量|限流|告警|灰度|回滚|SLA|客服通知|销售同步)/i.test(message)
        && /(Seedance|视频生成|Mini|mini|上架前|自助购买)/i.test(message)
        && !/(GMV|pipeline|目标|达成|经营健康|毛利|本月)/i.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_sre_launch_gate_review", args: { product_code: productCode(message), release_request_id: releaseRequestId(message) } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "sre_launch_gate_review", "云商品 SRE 上架门禁评审");
    },
  },
  {
    id: "cloud_ipd_readiness_review",
    matches(message) {
      return /(IPD|立项|PRD|上架前|上架检查|检查点|检查清单|就绪|还没完成|缺口|产品化|商品化)/i.test(message)
        && /(云商品|云产品|商品平台|ECS|GPU|云服务器|训练实例|Seedance|视频生成|视频模型|Agent\s*Plan|智能体套餐|AFP)/i.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_ipd_readiness_review", args: { product_code: productCode(message), release_request_id: releaseRequestId(message) } }];
    },
    composeAnswer(observations) {
      const product = productTitle(productCode(String(observations[0]?.call?.args?.product_code ?? "")));
      return composeNamedReport(observations[0] as ObservationView, "ipd_readiness", `${product} IPD 就绪评审`);
    },
  },
  {
    id: "cloud_gtm_package_draft",
    matches(message) {
      return /(GTM|销售话术|FAQ|目标客户|卖点|不能承诺|不可承诺|销售包|行业方案包)/i.test(message)
        && /(云商品|ECS|GPU|训练实例|云服务器|Seedance|视频生成|视频模型|Agent\s*Plan|智能体套餐|AFP)/i.test(message)
        && !/(发布|灰度|回滚|审批|上线|风险审查|检查清单)/.test(message);
    },
    calls(message) {
      return [{
        tool_name: "tool.cloud_gtm_package_draft",
        args: {
          product_code: productCode(message),
          industry: /金融/.test(message)
            ? "金融核心系统客户"
            : /开发者|企业研发|客户成功/.test(message)
              ? "开发者与企业协作客户"
              : undefined
        }
      }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "gtm_package", `${productTitle(productCode(observations[0]?.call?.args?.product_code as string ?? ""))} GTM 包草稿`);
    },
  },
  {
    id: "cloud_capacity_risk_review",
    matches(message) {
      return /(容量|GPU 池|GPU池|SRE|限售|灰度|新加坡|华东|交付窗口)/i.test(message)
        && /(ECS|GPU|云服务器|训练实例|云商品)/i.test(message)
        && !/(延期|事件|影响哪些订单|客户沟通|回滚)/.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_capacity_risk_review", args: { product_code: productCode(message), release_request_id: releaseRequestId(message) } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "capacity_review", "ECS GPU 容量风险评审");
    },
  },
  {
    id: "cloud_gmv_target_briefing",
    matches(message) {
      return /(GMV.*目标|目标.*GMV|目标完成|达成|经营健康|本月 GMV|毛利.*交付.*容量)/i.test(message)
        && /(ECS|GPU|云服务器|Seedance|视频生成|视频模型|Agent\s*Plan|智能体套餐|AFP|用量告警|pipeline)/i.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_gmv_target_briefing", args: { product_code: productCode(message), period: "2026-06" } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "gmv_briefing", `${productTitle(productCode(observations[0]?.call?.args?.product_code as string ?? ""))} GMV 目标驾驶舱`);
    },
  },
  {
    id: "cloud_ops_incident_business_impact",
    matches(message) {
      return /(运维事件|故障|交付延期|延期|影响哪些订单|客户沟通|回滚.*沟通|容量不足导致)/.test(message)
        && /(ECS|GPU|新加坡|容量)/i.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_ops_incident_business_impact", args: { product_code: productCode(message), incident_id: "inc_ecs_gpu_sg_delay_001" } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "ops_impact", "ECS GPU 运维事件经营影响分析");
    },
  },
  {
    id: "cloud_product_model_draft",
    matches(message) {
      if (/(IPD|上架前|检查点|检查清单|就绪|还没完成|缺口)/i.test(message)) return false;
      return /(云商品|云产品|商品平台|SKU|计费项|上架|接入清单|商品模型)/i.test(message)
        && /(产品经理|上架|接入|商品模型|SKU|计费项)/i.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_product_model_draft", args: { product_code: productCode(message), product_description: message } }];
    },
    composeAnswer(observations) {
      return composeProductDraft(observations[0] as ObservationView);
    },
  },
  {
    id: "cloud_executive_briefing",
    matches(message) {
      return /(云商品|云产品|云平台)/.test(message) && /(老板|经营|风险|卡住|阻塞|续约|优先级|影响金额|GMV|净收入|毛利|活跃客户|账单争议|争议金额)/.test(message);
    },
    calls() {
      return [{ tool_name: "tool.cloud_executive_briefing", args: { focus: "risk_workflow_renewal" } }];
    },
    composeAnswer(observations) {
      return composeExecutiveBriefing(observations[0] as ObservationView);
    },
  },
  {
    id: "cloud_solution_recommendation",
    matches(message) {
      if (/(自助询价|询价|套餐|多少秒|多少条|多少轮)/.test(message)) return false;
      if (/(发布|灰度|回滚|审批|上线|风险审查|检查清单)/.test(message)) return false;
      if (/(GTM|销售话术|FAQ|目标客户|卖点|不能承诺|不可承诺|销售包|行业方案包)/i.test(message)) return false;
      return /(云销售|销售|客户|方案|推荐|组合|解决方案|预算)/.test(message)
        && /(Seedance|Agent\s*Plan|TOS|CDN|短视频|智能客服|内容行业|ECS|GPU|RDS|CLB|金融|稳定|可审计|核心业务|数据库)/i.test(message);
    },
    calls(message) {
      const infra = /(ECS|GPU|RDS|CLB|金融|稳定|可审计|核心业务|数据库)/i.test(message);
      return [{
        tool_name: "tool.cloud_solution_recommendation",
        args: {
          industry: /金融/.test(message) ? "金融核心系统客户" : /内容行业/.test(message) ? "内容行业" : "客户行业",
          budget_cny: budgetCny(message) ?? 100000,
          needs: infra ? ["GPU 训练", "业务数据库", "稳定性优先", "可审计", "合同折扣审批"] : ["短视频批量生成", "智能客服", "素材存储", "内容分发"],
        },
      }];
    },
    composeAnswer(observations) {
      return composeSolution(observations[0] as ObservationView);
    },
  },
  {
    id: "cloud_self_service_quote",
    matches(message) {
      return /(自助询价|询价|套餐|预算|多少秒|多少条|多少轮)/.test(message)
        && /(Seedance|Agent\s*Plan|视频|对话|AFP)/i.test(message);
    },
    calls(message) {
      return [{
        tool_name: "tool.cloud_self_service_quote",
        args: {
          budget_cny: budgetCny(message) ?? 10000,
          quality: /1080/.test(message) ? "1080p_standard" : "720p_standard",
          target_duration_seconds: /10\s*秒/.test(message) ? 10 : 5,
          package_id: /small/i.test(message) ? "agent_plan_small" : /enterprise|企业/i.test(message) ? "agent_plan_enterprise" : "agent_plan_medium",
          scenario_type: /搜索|联网|工具/.test(message) ? "agent_with_search" : "agent_with_search",
        },
      }];
    },
    composeAnswer(observations) {
      return composeQuote(observations[0] as ObservationView);
    },
  },
  {
    id: "cloud_ops_degradation_plan",
    matches(message) {
      return /(失败率|降级|事故|客服通知|销售话术|商品页|队列|限流|告警|通知销售|大促)/.test(message)
        && /(Seedance|视频生成|视频模型|云商品)/i.test(message)
        && !/(发布审批|审批摘要|人审|发布申请)/.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_ops_degradation_plan", args: { product_code: productCode(message) } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "degradation_plan", `${productTitle(productCode(observations[0]?.call?.args?.product_code as string ?? ""))} 降级与通知方案`);
    },
  },
  {
    id: "cloud_agent_plan_overage_policy",
    matches(message) {
      return /(Agent\s*Plan|智能体套餐|AFP)/i.test(message) && /(额度用完|自动扣费|超额付费|二次确认|超额开通|扣费)/.test(message);
    },
    calls() {
      return [{ tool_name: "tool.cloud_agent_plan_overage_policy", args: {} }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "overage_policy", "Agent Plan 超额付费说明");
    },
  },
  {
    id: "cloud_retrospective_template",
    matches(message) {
      return /(复盘|下一次.*模板|商品上架模板|客户成功检查模板|沉淀.*模板)/.test(message)
        && /(Seedance|Agent\s*Plan|ECS|云商品|续约风险|上架|销售|交付|经营风险)/i.test(message);
    },
    calls(message) {
      return [{ tool_name: "tool.cloud_retrospective_template", args: { product_code: productCode(message) } }];
    },
    composeAnswer(observations) {
      return composeNamedReport(observations[0] as ObservationView, "retrospective_template", `${productTitle(productCode(observations[0]?.call?.args?.product_code as string ?? ""))} 上线复盘模板`);
    },
  },
  {
    id: "cloud_release_workflow",
    matches(message) {
      return /(审批摘要|回滚检查点|闭环|灰度发布|发布申请|上线风险|风险审查|帮我审查)/.test(message)
        && /(云商品|Seedance|rel_)/i.test(message);
    },
    calls(message) {
      const release_request_id = releaseRequestId(message);
      if (/(风险审查|上线风险|帮我审查|上架风险)/.test(message)) {
        return [{ tool_name: "tool.cloud_release_risk_review", args: { release_request_id } }];
      }
      return [{ tool_name: "tool.create_cloud_approval_summary", args: { release_request_id } }];
    },
    composeAnswer(observations) {
      const item = observations[0] as ObservationView;
      if (String(item.call.tool_name).includes("create_cloud_approval_summary")) return composeApprovalSummary(item);
      return composeNamedReport(item, "risk_report", "云商品发布风险审查");
    },
  },
];

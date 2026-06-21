import type { DeterministicRuleDefinition, IntentCodeInferenceFn } from "../types.js";

function productCode(text: string): string | null {
  const upper = text.toUpperCase();
  for (const code of ["SEEDANCE", "AGENT_PLAN", "OPENUI_DEMO", "ECS", "TOS", "OSS", "RDS", "RDS_MYSQL", "CDN", "CLB", "NLB", "ALB"]) {
    if (upper.includes(code)) return code === "OSS" ? "TOS" : code;
  }
  if (/对象存储/.test(text)) return "TOS";
  if (/云服务器|计算实例|GPU/.test(text)) return "ECS";
  if (/数据库|MYSQL/i.test(text)) return "RDS_MYSQL";
  if (/视频生成|视频模型|Seedance/.test(text)) return "SEEDANCE";
  if (/Agent\s*Plan|智能体套餐|AFP/i.test(text)) return "AGENT_PLAN";
  return null;
}

function productName(text: string): string | null {
  return text.match(/(?:名字叫|名称叫|名叫|叫)\s*([A-Za-z0-9_\-\u4e00-\u9fa5]{2,40})/)?.[1]
    ?? text.match(/([A-Za-z][A-Za-z0-9_\-]{1,40})\s*(?:是一款|是一个|是款)/)?.[1]
    ?? null;
}

function releaseRequestId(text: string): string | null {
  return text.match(/rel_[a-z0-9_]+/i)?.[0] ?? null;
}

function defaultReleaseRequestId(text: string): string {
  if (/(ECS|GPU|云服务器|训练实例)/i.test(text)) return "rel_ecs_gpu_train_202606";
  if (/(Agent\s*Plan|AFP|智能体套餐|企业协作)/i.test(text)) return "rel_agent_plan_enterprise_202606";
  if (/(Seedance|视频生成|视频模型|Mini|mini)/i.test(text)) return "rel_seedance_mini_selfserve_202606";
  return "rel_seedance_mini_202606";
}

function budgetCny(text: string): number | null {
  const wan = text.match(/(\d+(?:\.\d+)?)\s*万(?:元|块|预算)?/);
  if (wan) return Number(wan[1]) * 10000;
  const yuan = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|CNY|RMB)/i);
  return yuan ? Number(yuan[1]) : null;
}

function packageId(text: string): string | null {
  if (/small/i.test(text)) return "agent_plan_small";
  if (/medium|中杯|标准/i.test(text)) return "agent_plan_medium";
  if (/enterprise|企业/i.test(text)) return "agent_plan_enterprise";
  return null;
}

function hasCloudContext(text: string): boolean {
  return /(云商品|云产品|新商品|商品平台|商品化|商品模型|模型产品|模型服务|产品能力|技术能力|产品定义|产品化条件|主数据|血缘|字段归属|下游系统|变更影响|收入确认|递延收入|毛利底线|客户解释|正式报价|账单解释|发布后巡检|版本变更|存量客户|合同兼容|权益|渠道发布|官网|控制台|Marketplace|token|Token|TOKENS|会员|赠送额度|计费项|云客户|云厂商|云平台|SKU|Offer|Meter|合同价|云账单|云账期|云发票|发布申请|上线|上架|审批|Seedance|Agent\s*Plan|AFP|视频生成|ECS|GPU|IPD|GTM|SLA|容量|限流|告警|灰度|回滚|SRE|运维|交付延期|续约风险|TOS|OSS|RDS|CDN|CLB|NLB|ALB)/i.test(text)
    || /(我能看的|我的|客户自助).*(账单|发票)|(账单).*(发票状态|发票)/.test(text);
}

export const CLOUD_DETERMINISTIC_RULES: DeterministicRuleDefinition[] = [
  {
    id: "cloud.master_data.impact_review",
    intentCode: "cloud.master_data.impact_review",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(主数据|血缘|字段归属|下游系统|消费哪些字段|维护哪些字段|字段变更|修改.*影响|变更影响分析)/.test(message)) return null;
      return {
        intentCode: "cloud.master_data.impact_review",
        params: { product_code: productCode(message) ?? "SEEDANCE" },
        reasoning: "命中云商品主数据血缘和变更影响评审。",
      };
    },
  },
  {
    id: "cloud.financial.commercialization_review",
    intentCode: "cloud.financial.commercialization_review",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(收入确认|递延收入|免费额度成本|成本归集|毛利底线|毛利.*打穿|折扣.*叠加|促销.*叠加|财务口径|资源包收入)/.test(message)) return null;
      return {
        intentCode: "cloud.financial.commercialization_review",
        params: { product_code: productCode(message) ?? "AGENT_PLAN" },
        reasoning: "命中云商品财务商业化口径评审。",
      };
    },
  },
  {
    id: "cloud.customer.explanation",
    intentCode: "cloud.customer.explanation",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(客户.*解释|为什么.*账单|账单.*高于|正式报价|非正式报价|额度用完|会不会自动扣费|赠送.*过期|客户可见|买前确认|超额付费确认)/.test(message)) return null;
      return {
        intentCode: "cloud.customer.explanation",
        params: { product_code: productCode(message) ?? "AGENT_PLAN", scenario: message.slice(0, 120) },
        reasoning: "命中云客户买前/买后解释。",
      };
    },
  },
  {
    id: "cloud.product_change.impact_review",
    intentCode: "cloud.product_change.impact_review",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(版本|变更|调整套餐|新增.*SKU|SKU.*下线|Offer.*改名|价格调整|权益调整|地域扩容|存量客户|合同兼容|影响哪些客户)/.test(message)) return null;
      if (/(发布后巡检|上架后|24\s*小时|一致性检查)/.test(message)) return null;
      return {
        intentCode: "cloud.product_change.impact_review",
        params: { product_code: productCode(message) ?? "AGENT_PLAN" },
        reasoning: "命中云商品版本变更影响评审。",
      };
    },
  },
  {
    id: "cloud.post_launch.health_check",
    intentCode: "cloud.post_launch.health_check",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(发布后巡检|上架后|24\s*小时|渠道一致性|官网价格.*控制台|订单.*计量.*账单|客户反馈|发布健康日报)/.test(message)) return null;
      return {
        intentCode: "cloud.post_launch.health_check",
        params: { product_code: productCode(message) ?? "SEEDANCE", release_request_id: releaseRequestId(message) ?? defaultReleaseRequestId(message) },
        reasoning: "命中云商品发布后巡检。",
      };
    },
  },
  {
    id: "cloud.productization.readiness_review",
    intentCode: "cloud.productization.readiness_review",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(产品能力|技术能力|模型能力|产品化条件|产品定义交付物|具备产品化|产品化定义|能力边界|是否.*产品化)/.test(message)) return null;
      return {
        intentCode: "cloud.productization.readiness_review",
        params: { product_code: productCode(message) ?? "SEEDANCE" },
        reasoning: "命中云产品能力产品化定义评审。",
      };
    },
  },
  {
    id: "cloud.offer.design_review",
    intentCode: "cloud.offer.design_review",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(Offer|SKU|Meter|Price|售卖方式|按量.*包月|包月.*按量|几个\s*Offer|资源包.*互斥|促销.*互斥|折扣.*互斥)/i.test(message)) return null;
      if (!/(设计|关系|治理|能否同时存在|应该.*几个|互斥|冲突)/.test(message)) return null;
      return {
        intentCode: "cloud.offer.design_review",
        params: { product_code: productCode(message) ?? "AGENT_PLAN" },
        reasoning: "命中云商品 Offer/SKU/计量/价格治理评审。",
      };
    },
  },
  {
    id: "cloud.plan.entitlement_review",
    intentCode: "cloud.plan.entitlement_review",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(权益|赠送额度|每天送|每日送|过期|退订|退款|超额|二次确认|账单解释|自动扣费)/.test(message)) return null;
      return {
        intentCode: "cloud.plan.entitlement_review",
        params: { product_code: productCode(message) ?? "AGENT_PLAN" },
        reasoning: "命中 Plan 型权益治理评审。",
      };
    },
  },
  {
    id: "cloud.channel.publication_review",
    intentCode: "cloud.channel.publication_review",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(官网|控制台|销售渠道|销售报价|API|Marketplace|渠道发布|展示哪些字段|哪些不能展示|禁展示)/i.test(message)) return null;
      return {
        intentCode: "cloud.channel.publication_review",
        params: { product_code: productCode(message) ?? "SEEDANCE" },
        reasoning: "命中云商品渠道发布矩阵评审。",
      };
    },
  },
  {
    id: "cloud.sre.launch_gate_review",
    intentCode: "cloud.sre.launch_gate_review",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(SRE|稳定性门禁|上架门禁|容量|限流|告警|灰度|回滚|SLA|客服通知|销售同步)/i.test(message)) return null;
      if (/(GMV|pipeline|目标|达成|经营健康|毛利|本月)/i.test(message)) return null;
      if (/(ECS|GPU|新加坡|华东|容量池|交付窗口|限售)/i.test(message) && !/(Seedance|视频生成|Mini|mini)/i.test(message)) return null;
      return {
        intentCode: "cloud.sre.launch_gate_review",
        params: { product_code: productCode(message) ?? "SEEDANCE", release_request_id: releaseRequestId(message) ?? defaultReleaseRequestId(message) },
        reasoning: "命中云商品 SRE 上架门禁评审。",
      };
    },
  },
  {
    id: "cloud.ops.degradation_plan",
    intentCode: "cloud.ops.degradation_plan",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(失败率|降级|事故|客服通知|销售话术|商品页)/.test(message)) return null;
      if (/(发布审批|审批摘要|人审|回滚|发布申请)/.test(message)) return null;
      return {
        intentCode: "cloud.ops.degradation_plan",
        params: { product_code: productCode(message) ?? "SEEDANCE" },
        reasoning: "命中云商品上线事故降级方案。",
      };
    },
  },
  {
    id: "cloud.retrospective.template",
    intentCode: "cloud.retrospective.template",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(复盘|下一次.*模板|商品上架模板|客户成功检查模板|沉淀.*模板)/.test(message)) return null;
      return {
        intentCode: "cloud.retrospective.template",
        params: { product_code: productCode(message) ?? "SEEDANCE" },
        reasoning: "命中云商品上线复盘模板。",
      };
    },
  },
  {
    id: "cloud.agent_plan.overage_policy",
    intentCode: "cloud.agent_plan.overage_policy",
    priority: 0,
    match: ({ message }) => {
      if (!/(Agent\s*Plan|AFP|智能体套餐)/i.test(message)) return null;
      if (!/(额度用完|自动扣费|超额付费|二次确认|超额开通|扣费)/.test(message)) return null;
      return {
        intentCode: "cloud.agent_plan.overage_policy",
        params: { product_code: "AGENT_PLAN" },
        reasoning: "命中 Agent Plan 超额付费客户解释。",
      };
    },
  },
  {
    id: "cloud.agent_plan.margin_risk",
    intentCode: "cloud.gmv.target_briefing",
    priority: 0,
    match: ({ message }) => {
      if (!/(Agent\s*Plan|AFP|智能体套餐)/i.test(message)) return null;
      if (!/(高成本模型|联网搜索|视频生成|毛利打穿|毛利风险|成本项)/.test(message)) return null;
      return {
        intentCode: "cloud.gmv.target_briefing",
        params: { product_code: "AGENT_PLAN", period: "2026-06" },
        reasoning: "命中 Agent Plan 毛利风险经营简报。",
      };
    },
  },
  {
    id: "cloud.renewal.briefing",
    intentCode: "cloud.executive.briefing",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(续约|ARR|本周.*跟进|重点客户)/.test(message)) return null;
      return {
        intentCode: "cloud.executive.briefing",
        params: { focus: /模板|复盘|沉淀/.test(message) ? "renewal_template" : "renewal_risks" },
        reasoning: "命中云客户续约风险简报。",
      };
    },
  },
  {
    id: "cloud.seedance.price_guard",
    intentCode: "cloud.gtm.package_draft",
    priority: 0,
    match: ({ message }) => {
      if (!/(Seedance|视频生成|Mini|mini)/i.test(message)) return null;
      if (!/(价格|资源包|合同折扣|互斥|促销|毛利底线)/.test(message)) return null;
      return {
        intentCode: "cloud.gtm.package_draft",
        params: { product_code: "SEEDANCE", industry: "价格护栏与折扣互斥" },
        reasoning: "命中 Seedance 价格护栏与折扣互斥。",
      };
    },
  },
  {
    id: "cloud.seedance.queue_health",
    intentCode: "cloud.ops.degradation_plan",
    priority: 0,
    match: ({ message }) => {
      if (!/(Seedance|视频生成|Mini|mini)/i.test(message)) return null;
      if (!/(队列|限流|告警|通知销售|大促|生成失败率|失败率)/.test(message)) return null;
      if (/(发布审批|审批摘要|人审|回滚|发布申请)/.test(message)) return null;
      return {
        intentCode: "cloud.ops.degradation_plan",
        params: { product_code: "SEEDANCE" },
        reasoning: "命中 Seedance 队列健康与降级方案。",
      };
    },
  },
  {
    id: "cloud.ipd.readiness_review",
    intentCode: "cloud.ipd.readiness_review",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(IPD|立项|PRD|上架前|上架检查|检查点|检查清单|就绪|还没完成|缺口|产品化评审|商品化评审)/i.test(message)) return null;
      return {
        intentCode: "cloud.ipd.readiness_review",
        params: { product_code: productCode(message) ?? "SEEDANCE", release_request_id: releaseRequestId(message) ?? defaultReleaseRequestId(message) },
        reasoning: "命中云商品 IPD 商品化就绪评审。",
      };
    },
  },
  {
    id: "cloud.gtm.package_draft",
    intentCode: "cloud.gtm.package_draft",
    priority: 1,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(GTM|销售话术|FAQ|目标客户|卖点|不能承诺|不可承诺|销售包|行业方案包)/i.test(message)) return null;
      if (/(发布|灰度|回滚|审批|上线|风险审查|检查清单)/.test(message)) return null;
      return {
        intentCode: "cloud.gtm.package_draft",
        params: { product_code: productCode(message) ?? "SEEDANCE", industry: /金融/.test(message) ? "金融核心系统客户" : /电商|营销|UGC|内容/.test(message) ? "内容生产客户" : /开发者|企业研发|客户成功/.test(message) ? "开发者与企业协作客户" : undefined },
        reasoning: "命中云商品 GTM 包草稿。",
      };
    },
  },
  {
    id: "cloud.capacity.risk_review",
    intentCode: "cloud.capacity.risk_review",
    priority: 1,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(容量|GPU 池|GPU池|SRE|限售|灰度|新加坡|华东|交付窗口)/i.test(message)) return null;
      if (/(GMV|目标|达成|经营健康)/i.test(message)) return null;
      if (/(自助询价|询价|预算|买什么规格|正式报价|价格是不是)/.test(message)) return null;
      if (/(延期|事件|影响哪些订单|客户沟通|回滚)/.test(message)) return null;
      return {
        intentCode: "cloud.capacity.risk_review",
        params: { product_code: productCode(message) ?? "ECS", release_request_id: releaseRequestId(message) ?? "rel_ecs_gpu_train_202606" },
        reasoning: "命中 ECS GPU 容量风险评审。",
      };
    },
  },
  {
    id: "cloud.gmv.target_briefing",
    intentCode: "cloud.gmv.target_briefing",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(GMV.*目标|目标.*GMV|目标完成|达成|经营健康|本月 GMV|毛利.*交付.*容量|毛利|折扣|价格)/i.test(message)) return null;
      if (!productCode(message)) return null;
      if (/(发布|灰度|回滚|审批|上线|风险审查|检查清单|rel_)/.test(message)) return null;
      if (/(自助询价|询价|预算|买什么规格|正式报价|价格是不是)/.test(message)) return null;
      return {
        intentCode: "cloud.gmv.target_briefing",
        params: { product_code: productCode(message) ?? "SEEDANCE", period: /2026-06|6\s*月/.test(message) ? "2026-06" : undefined },
        reasoning: "命中云商品 GMV 目标驾驶舱。",
      };
    },
  },
  {
    id: "cloud.ops.incident_impact",
    intentCode: "cloud.ops.incident_impact",
    priority: 1,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(运维事件|故障|交付延期|延期|影响哪些订单|客户沟通|回滚.*沟通|容量不足导致)/.test(message)) return null;
      if (!/(ECS|GPU|新加坡|容量)/i.test(message)) return null;
      return {
        intentCode: "cloud.ops.incident_impact",
        params: { product_code: productCode(message) ?? "ECS", incident_id: "inc_ecs_gpu_sg_delay_001" },
        reasoning: "命中 ECS GPU 运维事件经营影响分析。",
      };
    },
  },
  {
    id: "cloud.executive.briefing.metrics",
    intentCode: "cloud.executive.briefing",
    priority: 2,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(GMV|净收入|毛利|活跃客户|账单争议|经营指标)/i.test(message)) return null;
      if (!/(云商品|云平台|平台|本月|经营|老板|管理|指标)/.test(message)) return null;
      return {
        intentCode: "cloud.executive.briefing",
        params: { focus: "operating_metrics" },
        reasoning: "命中云商品经营指标简报。",
      };
    },
  },
  {
    id: "cloud.query.operations",
    intentCode: "cloud.query.operations",
    priority: 3,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(经营指标|GMV|净收入|毛利|活跃客户|争议金额|续约风险金额|发布阻塞)/i.test(message)) return null;
      return {
        intentCode: "cloud.query.operations",
        params: {},
        reasoning: "命中云商品经营指标查询。",
      };
    },
  },
  {
    id: "cloud.query.billing",
    intentCode: "cloud.query.billing",
    priority: 4,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(账单|发票|账期|争议金额|dispute)/i.test(message)) return null;
      return {
        intentCode: "cloud.query.billing",
        params: {
          billing_month: /2026\s*年\s*6\s*月|2026-06/.test(message) ? "2026-06" : undefined,
          status: /争议/.test(message) ? "disputed" : undefined,
        },
        reasoning: "命中云商品账单/发票查询。",
      };
    },
  },
  {
    id: "cloud.executive.briefing",
    intentCode: "cloud.executive.briefing",
    priority: 5,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(老板|经营|管理|总览|风险|谁.*卡|卡住|阻塞|续约|优先级|影响金额|GMV|净收入|毛利|活跃客户|账单争议)/.test(message)) return null;
      if (!/(老板|经营|总览|优先级|影响金额|GMV|净收入|毛利|活跃客户|账单争议|风险.*流程|流程.*续约|风险.*续约|卡住.*续约|谁.*卡|卡住.*流程|流程.*阻塞|阻塞.*流程)/.test(message)) return null;
      return {
        intentCode: "cloud.executive.briefing",
        params: { focus: "risk_workflow_renewal" },
        reasoning: "命中云商品老板视角经营简报。",
      };
    },
  },
  {
    id: "cloud.solution.recommendation",
    intentCode: "cloud.solution.recommendation",
    priority: 8,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (/(自助询价|询价|套餐|多少秒|多少条|多少轮)/.test(message)) return null;
      if (/(发布|灰度|回滚|审批|上线|风险审查|检查清单)/.test(message)) return null;
      if (!/(销售|客户|方案|推荐|组合|解决方案|预算)/.test(message)) return null;
      if (!/(Seedance|Agent\s*Plan|TOS|CDN|短视频|智能客服|内容行业|ECS|GPU|RDS|CLB|金融|稳定|可审计|核心业务|数据库)/i.test(message)) return null;
      return {
        intentCode: "cloud.solution.recommendation",
        params: {
          budget_cny: budgetCny(message) ?? 100000,
          industry: /金融/.test(message) ? "金融核心系统客户" : /内容行业/.test(message) ? "内容行业" : undefined,
          needs: /(ECS|GPU|RDS|CLB|金融|稳定|可审计|核心业务|数据库)/i.test(message)
            ? ["GPU 训练", "业务数据库", "稳定性优先", "可审计", "合同折扣审批"]
            : ["短视频批量生成", "智能客服", "素材存储", "内容分发"],
        },
        reasoning: "命中云商品销售解决方案推荐。",
      };
    },
  },
  {
    id: "cloud.quote.self_service",
    intentCode: "cloud.quote.self_service",
    priority: 6,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(自助询价|询价|套餐|预算|多少秒|多少条|多少轮)/.test(message)) return null;
      if (!/(Seedance|Agent\s*Plan|视频|对话|AFP|ECS|GPU|云服务器|训练实例)/i.test(message)) return null;
      if (/(Seedance|视频)/i.test(message) && !/(Agent\s*Plan|AFP|对话|多少轮)/i.test(message)) {
        return {
          intentCode: "cloud.estimate.seedance_video_seconds",
          params: {
            budget_cny: budgetCny(message) ?? 10000,
            quality: /1080/.test(message) ? "1080p_standard" : "720p_standard",
            target_duration_seconds: /10\s*秒/.test(message) ? 10 : 5,
          },
          reasoning: "命中 Seedance 单品自助估算。",
        };
      }
      if (/(Agent\s*Plan|AFP|对话|多少轮)/i.test(message) && !/(Seedance|视频.*多少秒|多少条.*视频)/i.test(message)) {
        return {
          intentCode: "cloud.estimate.agent_plan_rounds",
          params: {
            package_id: packageId(message) ?? "agent_plan_medium",
            scenario_type: /搜索|联网|工具/.test(message) ? "agent_with_search" : undefined,
          },
          reasoning: "命中 Agent Plan 单品自助估算。",
        };
      }
      return {
        intentCode: /(ECS|GPU|云服务器|训练实例)/i.test(message) ? "cloud.solution.recommendation" : "cloud.quote.self_service",
        params: {
          budget_cny: budgetCny(message) ?? 10000,
          industry: /(ECS|GPU|云服务器|训练实例)/i.test(message) ? "AI 训练客户" : undefined,
          needs: /(ECS|GPU|云服务器|训练实例)/i.test(message) ? ["GPU 训练", "华东 1 包月", "正式报价前复核"] : undefined,
          quality: /1080/.test(message) ? "1080p_standard" : "720p_standard",
          target_duration_seconds: /10\s*秒/.test(message) ? 10 : 5,
          package_id: packageId(message) ?? "agent_plan_medium",
          scenario_type: /搜索|联网|工具/.test(message) ? "agent_with_search" : undefined,
        },
        reasoning: "命中云商品客户自助询价。",
      };
    },
  },
  {
    id: "cloud.estimate.agent_plan_rounds",
    intentCode: "cloud.estimate.agent_plan_rounds",
    priority: 15,
    match: ({ message }) => {
      if (!/(Agent\s*Plan|AFP|智能体套餐|对话多少轮|多少轮对话)/i.test(message)) return null;
      return {
        intentCode: "cloud.estimate.agent_plan_rounds",
        params: {
          package_id: packageId(message) ?? "agent_plan_medium",
          extra_budget_cny: /额外|加购|超额/.test(message) ? budgetCny(message) : undefined,
          scenario_type: /搜索|联网|工具/.test(message) ? "agent_with_search" : undefined,
        },
        reasoning: "命中 Agent Plan 轮数估算。",
      };
    },
  },
  {
    id: "cloud.estimate.seedance_video_seconds",
    intentCode: "cloud.estimate.seedance_video_seconds",
    priority: 15,
    match: ({ message }) => {
      if (!/(Seedance|视频生成|生成多少秒|多少条.*视频|视频秒数)/i.test(message)) return null;
      if (!/(预算|元|万|套餐|多少秒|多少条)/.test(message)) return null;
      return {
        intentCode: "cloud.estimate.seedance_video_seconds",
        params: {
          budget_cny: budgetCny(message) ?? 10000,
          quality: /1080/.test(message) ? "1080p_standard" : "720p_standard",
          target_duration_seconds: /10\s*秒/.test(message) ? 10 : 5,
        },
        reasoning: "命中 Seedance 视频预算估算。",
      };
    },
  },
  {
    id: "cloud.modeling.product_to_commodity",
    intentCode: "cloud.modeling.product_to_commodity",
    priority: 0,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (/(IPD|上架前|检查点|检查清单|就绪|还没完成|缺口)/i.test(message)) return null;
      if (!/(上一个新的?商品|新增商品|新商品|商品化|商品模型|配置草稿|购买页字段|上架.*字段|接入清单|SKU.*拆|怎么拆 SKU|模型产品|按\s*token\s*计费|token计费|会员.*赠送|赠送.*token)/i.test(message)) return null;
      return {
        intentCode: "cloud.modeling.product_to_commodity",
        params: {
          product_code: productCode(message) ?? undefined,
          product_name: productName(message) ?? undefined,
          product_description: message
        },
        reasoning: "命中云商品建模/配置草稿。",
      };
    },
  },
  {
    id: "cloud.risk.release_review",
    intentCode: "cloud.risk.release_review",
    priority: 20,
    match: ({ message }) => {
      if (!/(风险审查|上线风险|发布风险|帮我审查|上架风险)/.test(message)) return null;
      return {
        intentCode: "cloud.risk.release_review",
        params: { release_request_id: releaseRequestId(message) ?? defaultReleaseRequestId(message) },
        reasoning: "命中云商品发布风险审查。",
      };
    },
  },
  {
    id: "cloud.workflow.release_request",
    intentCode: "cloud.workflow.release_request",
    priority: 7,
    match: ({ message }) => {
      if (!/(审批摘要|回滚检查点|闭环|灰度发布|发布申请|创建.*草稿)/.test(message)) return null;
      return {
        intentCode: "cloud.workflow.release_request",
        params: { release_request_id: releaseRequestId(message) ?? defaultReleaseRequestId(message) },
        reasoning: "命中云商品发布流程/审批摘要。",
      };
    },
  },
  {
    id: "cloud.query.risks",
    intentCode: "cloud.query.risks",
    priority: 30,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(风险|老板|管理者|谁.*卡|卡住|拖慢|阻塞|续约)/.test(message)) return null;
      if (/续约/.test(message)) return { intentCode: "cloud.query.renewals", params: {}, reasoning: "命中云客户续约查询。" };
      if (/(卡住|拖慢|阻塞|流程)/.test(message)) return { intentCode: "cloud.query.workflow_bottlenecks", params: { status: "blocked" }, reasoning: "命中流程阻塞查询。" };
      return { intentCode: "cloud.query.risks", params: {}, reasoning: "命中云商品风险查询。" };
    },
  },
  {
    id: "cloud.query.products_or_prices",
    intentCode: "cloud.query.products",
    priority: 40,
    match: ({ message }) => {
      if (!hasCloudContext(message)) return null;
      if (!/(云商品|云产品|产品|SKU|价格|计费|Offer|Meter|地域|合同价)/i.test(message)) return null;
      if (/(价格|单价|计费|合同价)/.test(message)) {
        return { intentCode: "cloud.query.prices", params: { product_code: productCode(message) ?? undefined }, reasoning: "命中云商品价格查询。" };
      }
      return { intentCode: "cloud.query.products", params: { product_code: productCode(message) ?? undefined }, reasoning: "命中云商品主数据查询。" };
    },
  },
];

export const CLOUD_INTENT_CODE_INFERENCE: IntentCodeInferenceFn[] = [
  (message) => {
    if (!/(云商品|云产品|云客户|主数据|血缘|字段归属|收入确认|递延收入|客户解释|正式报价|版本变更|发布后巡检|产品能力|模型能力|产品化|权益|官网|控制台|Marketplace|Seedance|Agent\s*Plan|AFP|SKU|Offer|Meter|计费项|发布申请|上线风险|合同价|云账单|云账期|云发票|ECS|GPU|IPD|GTM|SLA|容量|限流|告警|灰度|回滚|SRE|运维|交付延期|续约风险)/i.test(message) && !/(我能看的|我的|客户自助).*(账单|发票)|(账单).*(发票状态|发票)/.test(message)) return null;
    if (/(主数据|血缘|字段归属|下游系统|消费哪些字段|维护哪些字段|字段变更|修改.*影响|变更影响分析)/.test(message)) return "cloud.master_data.impact_review";
    if (/(收入确认|递延收入|免费额度成本|成本归集|毛利底线|毛利.*打穿|折扣.*叠加|促销.*叠加|财务口径|资源包收入)/.test(message)) return "cloud.financial.commercialization_review";
    if (/(客户.*解释|为什么.*账单|账单.*高于|正式报价|非正式报价|额度用完|会不会自动扣费|赠送.*过期|客户可见|买前确认|超额付费确认)/.test(message)) return "cloud.customer.explanation";
    if (/(发布后巡检|上架后|24\s*小时|渠道一致性|官网价格.*控制台|订单.*计量.*账单|客户反馈|发布健康日报)/.test(message)) return "cloud.post_launch.health_check";
    if (/(版本|变更|调整套餐|新增.*SKU|SKU.*下线|Offer.*改名|价格调整|权益调整|地域扩容|存量客户|合同兼容|影响哪些客户)/.test(message)) return "cloud.product_change.impact_review";
    if (/(产品能力|技术能力|模型能力|产品化条件|产品定义交付物|具备产品化|产品化定义|能力边界|是否.*产品化)/.test(message)) return "cloud.productization.readiness_review";
    if (/(Offer|SKU|Meter|Price|售卖方式|按量.*包月|包月.*按量|几个\s*Offer|资源包.*互斥|促销.*互斥|折扣.*互斥)/i.test(message) && /(设计|关系|治理|能否同时存在|应该.*几个|互斥|冲突)/.test(message)) return "cloud.offer.design_review";
    if (/(权益|赠送额度|每天送|每日送|过期|退订|退款|超额|二次确认|账单解释|自动扣费)/.test(message)) return "cloud.plan.entitlement_review";
    if (/(官网|控制台|销售渠道|销售报价|API|Marketplace|渠道发布|展示哪些字段|哪些不能展示|禁展示)/i.test(message)) return "cloud.channel.publication_review";
    if (/(SRE|稳定性门禁|上架门禁|容量|限流|告警|灰度|回滚|SLA|客服通知|销售同步)/i.test(message) && /(Seedance|视频生成|Mini|mini|上架前)/i.test(message) && !/(GMV|pipeline|目标|达成|经营健康|毛利|本月)/i.test(message)) return "cloud.sre.launch_gate_review";
    if (/(IPD|立项|PRD|商品模型|购买页字段|上架检查|产品化|商品化)/i.test(message)) return "cloud.ipd.readiness_review";
    if (/(GTM|销售话术|FAQ|目标客户|不能承诺|不可承诺|销售包|行业方案包)/i.test(message) && !/(发布|灰度|回滚|审批|上线|风险审查|检查清单)/.test(message)) return "cloud.gtm.package_draft";
    if (/(运维事件|故障|交付延期|影响哪些订单|客户沟通|容量不足导致)/.test(message) && /(ECS|GPU|新加坡|容量)/i.test(message)) return "cloud.ops.incident_impact";
    if (/(容量|GPU 池|GPU池|SRE|限售|灰度|新加坡|华东)/i.test(message)) return "cloud.capacity.risk_review";
    if (/(GMV.*目标|目标.*GMV|目标完成|达成|经营健康|本月 GMV)/i.test(message) && productCode(message)) return "cloud.gmv.target_briefing";
    if (/(经营指标|GMV|毛利|净收入|活跃客户)/i.test(message) && /(云商品|云平台|平台|本月|老板|管理|简报|结论)/.test(message)) return "cloud.executive.briefing";
    if (/(经营指标|GMV|毛利|净收入|活跃客户)/i.test(message)) return "cloud.query.operations";
    if (/(账单|发票|账期|争议金额)/i.test(message)) return "cloud.query.billing";
    if (/(老板|经营|总览|风险.*流程|流程.*续约|卡住.*续约|影响金额)/.test(message)) return "cloud.executive.briefing";
    if (/(销售|方案|推荐|组合|解决方案|内容行业|智能客服|ECS|GPU|RDS|CLB|金融|稳定|可审计)/.test(message) && !/(发布|灰度|回滚|审批|上线|风险审查|检查清单)/.test(message)) return "cloud.solution.recommendation";
    if (/(自助询价|询价|套餐)/.test(message)) return "cloud.quote.self_service";
    if (/(多少轮|对话轮数|AFP)/i.test(message)) return "cloud.estimate.agent_plan_rounds";
    if (/(视频.*多少秒|多少条.*视频|Seedance.*预算)/i.test(message)) return "cloud.estimate.seedance_video_seconds";
    if (/(风险审查|上线风险|发布风险)/.test(message)) return "cloud.risk.release_review";
    if (/(审批摘要|回滚检查点|闭环|发布申请)/.test(message)) return "cloud.workflow.release_request";
    if (/(风险|老板|阻塞|卡住)/.test(message)) return "cloud.query.risks";
    if (/(价格|计费|合同价)/.test(message)) return "cloud.query.prices";
    return "cloud.query.products";
  },
];

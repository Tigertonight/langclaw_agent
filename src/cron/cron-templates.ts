/**
 * Phase 5.2: CronTemplates —— 预置汽车经销商场景的 cron 模板库。
 *
 * 业务背景：
 *   经销商运营场景中，有一批固定周期性任务可以完全交给 agent 自动执行：
 *   日报汇总、库存风险巡检、超期工单提醒、线索清零检查、财务异常摘要。
 *
 * 模板结构：
 *   - id            : slug，便于工具按名称查找
 *   - name          : 人类可读名称
 *   - description   : 详细说明（用于 UI 展示）
 *   - cron_expr     : 5 字段标准 cron（分 时 日 月 周）
 *   - task          : 子 agent 执行时的自然语言任务目标
 *   - domain        : 业务域（dealer_sales / dealer_inventory / dealer_aftersales / dealer_finance）
 *   - allowed_tools : 推荐工具白名单（空则走全集）
 *   - max_steps     : 推荐最大步数
 */

export interface CronTemplate {
  id: string;
  name: string;
  description: string;
  cron_expr: string;
  task: string;
  domain: string;
  allowed_tools: string[];
  max_steps: number;
  tags: string[];
}

export const CRON_TEMPLATES: CronTemplate[] = [
  {
    id: "daily_sales_report",
    name: "每日销售日报",
    description: "每天 09:00 自动汇总前一日的销售订单、成交台量、毛利、线索转化率，生成结构化日报存入 task store，供晨会参考。",
    cron_expr: "0 9 * * *",
    task: "生成昨日经营日报：汇总昨日销售订单数量、成交金额、毛利、线索量、线索转化率，识别异常（日环比 ±15% 以上），以结构化方式输出结论（结论 + 关键指标 + 异常条目 + 数据时间戳）。",
    domain: "dealer_sales",
    allowed_tools: [
      "dealer.query_sales_orders",
      "dealer.query_leads",
      "dealer.query_vehicles",
      "task.create",
      "task.complete",
      "task.link_evidence"
    ],
    max_steps: 8,
    tags: ["daily", "report", "sales"]
  },
  {
    id: "inventory_risk_check",
    name: "库存风险巡检",
    description: "每天 10:00 扫描库龄超过 90 天的车辆，识别滞销风险，输出车型/库龄/建议处置方式的列表。",
    cron_expr: "0 10 * * *",
    task: "扫描当前在库车辆，识别库龄超过 90 天的滞销车型，按库龄倒序排列，每条给出建议处置方式（降价促销 / 调拨 / 退厂），输出不超过 20 条的风险清单，写入 task store。",
    domain: "dealer_inventory",
    allowed_tools: [
      "dealer.query_vehicles",
      "dealer.query_sales_orders",
      "task.create",
      "task.complete",
      "task.link_evidence"
    ],
    max_steps: 6,
    tags: ["daily", "inventory", "risk"]
  },
  {
    id: "overdue_workorder_alert",
    name: "超期工单提醒",
    description: "每天 11:00 检查维修工单，找出超承诺工期的在修工单，发送提醒摘要，帮助售后主管及时跟进。",
    cron_expr: "0 11 * * *",
    task: "查询所有状态为「在修」的维修工单，计算每单实际在厂天数，找出超过承诺工期的工单，按超期天数降序排列，生成超期工单提醒报告（工单号 / 车牌 / 超期天数 / 当前状态 / 建议行动），写入 task store。",
    domain: "dealer_aftersales",
    allowed_tools: [
      "dealer.query_repair_orders",
      "dealer.query_vehicles",
      "task.create",
      "task.complete",
      "task.link_evidence"
    ],
    max_steps: 6,
    tags: ["daily", "aftersales", "workorder"]
  },
  {
    id: "lead_clearance_weekly",
    name: "线索清零周检",
    description: "每周一 09:30 检查本周新增线索的跟进状态，识别超过 48 小时未跟进的线索，发出清零提醒，防止线索流失。",
    cron_expr: "30 9 * * 1",
    task: "查询本周所有新增线索，找出创建超过 48 小时仍未完成首次跟进（状态为「未跟进」）的线索，按创建时间升序排列，生成线索清零提醒报告（线索编号 / 客户姓名 / 意向车型 / 创建时间 / 逾期小时数 / 负责人），写入 task store 并标记为紧急。",
    domain: "dealer_sales",
    allowed_tools: [
      "dealer.query_leads",
      "dealer.query_customers",
      "task.create",
      "task.complete",
      "task.link_evidence"
    ],
    max_steps: 7,
    tags: ["weekly", "sales", "leads", "urgent"]
  },
  {
    id: "finance_anomaly_daily",
    name: "每日财务异常摘要",
    description: "每天 17:30 检查当日财务流水，识别金额异常（单笔超过均值 3 倍）、科目异常、缺单情况，生成 EOD 财务异常摘要。",
    cron_expr: "30 17 * * *",
    task: "查询当日财务数据，识别异常条目：单笔金额超过近 7 日日均 3 倍的、科目归属异常的、应收/应付缺少配对凭证的。输出 EOD 财务异常摘要（异常类型 / 金额 / 科目 / 时间戳 / 建议处置），无异常时输出【本日财务流水正常】，写入 task store。",
    domain: "dealer_finance",
    allowed_tools: [
      "dealer.query_finance",
      "dealer.query_sales_orders",
      "task.create",
      "task.complete",
      "task.link_evidence"
    ],
    max_steps: 8,
    tags: ["daily", "finance", "anomaly"]
  }
];

/**
 * 按 id 查找单个模板。
 */
export function findTemplate(id: string): CronTemplate | null {
  return CRON_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * 按 domain 或 tag 过滤模板列表。
 */
export function filterTemplates(opts: {
  domain?: string;
  tag?: string;
  q?: string;
}): CronTemplate[] {
  return CRON_TEMPLATES.filter((t) => {
    if (opts.domain && t.domain !== opts.domain) return false;
    if (opts.tag && !t.tags.includes(opts.tag)) return false;
    if (opts.q) {
      const q = opts.q.toLowerCase();
      if (
        !t.name.toLowerCase().includes(q) &&
        !t.description.toLowerCase().includes(q) &&
        !t.id.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
}

/**
 * 将模板转换为可直接传给 UserCronStore.create() 的输入。
 * overrides 可覆盖 task / allowed_tools / max_steps 等字段。
 */
export function applyTemplate(
  template: CronTemplate,
  userId: string,
  overrides?: {
    task?: string;
    allowed_tools?: string[];
    max_steps?: number;
    total_timeout_ms?: number;
    missed_window?: "skip" | "catch_up";
  }
): {
  user_id: string;
  cron_expr: string;
  task: string;
  allowed_tools?: string[];
  max_steps?: number;
  total_timeout_ms?: number;
  missed_window?: "skip" | "catch_up";
  metadata?: Record<string, string>;
} {
  return {
    user_id: userId,
    cron_expr: template.cron_expr,
    task: overrides?.task ?? template.task,
    allowed_tools: overrides?.allowed_tools ?? (template.allowed_tools.length > 0 ? template.allowed_tools : undefined),
    max_steps: overrides?.max_steps ?? template.max_steps,
    total_timeout_ms: overrides?.total_timeout_ms,
    missed_window: overrides?.missed_window ?? "skip"
  };
}

/** 模板摘要，用于工具返回时的紧凑展示。 */
export interface CronTemplateSummary {
  id: string;
  name: string;
  description: string;
  cron_expr: string;
  domain: string;
  tags: string[];
}

export function summarizeTemplate(t: CronTemplate): CronTemplateSummary {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    cron_expr: t.cron_expr,
    domain: t.domain,
    tags: t.tags
  };
}

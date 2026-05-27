/**
 * Core domain report composers.
 *
 * 从 local-llm.ts 迁移的 tool-specific 答案模板和风险分析逻辑。
 * 通过 DomainPack.reportComposers 声明式注册到 DomainRegistry。
 */

import type { ReportComposerDefinition } from "../types.js";
import type { ToolResult, JsonObject } from "../../types/agent-contracts.js";

type DataRecord = Record<string, unknown>;

// ── 客户订单风险分析 composer ──────────────────────────────────────────────

export const CUSTOMER_ORDER_RISK_COMPOSER: ReportComposerDefinition = {
  id: "core.customer_order_risk",
  matches({ question, toolResults }) {
    const wantsRiskAnalysis = /(分析|风险|诊断|复盘|优先级|建议|行动)/.test(question);
    if (!wantsRiskAnalysis) return false;
    return toolResults.some((r) =>
      r.tool === "list_my_customers"
      || r.tool === "query_customer"
      || r.tool === "query_order"
      || (r.tool === "query_business_data" && ((r.data as DataRecord)?.resource === "customers" || (r.data as DataRecord)?.resource === "orders"))
    );
  },
  compose({ question, toolResults }) {
    const customers = new Map<unknown, DataRecord>();
    const orders: DataRecord[] = [];
    for (const result of toolResults) {
      const data = result.data as DataRecord | undefined;
      if (result.tool === "list_my_customers") {
        for (const customer of (data?.customers as DataRecord[] | undefined) ?? []) {
          if (customer?.id || customer?.name) customers.set(customer.id ?? customer.name, customer);
        }
      }
      if (result.tool === "query_customer" && data) {
        customers.set(data.id ?? data.name, data);
      }
      if (result.tool === "query_order" && data) {
        orders.push(data);
      }
      if (result.tool === "query_business_data" && data?.resource === "customers") {
        for (const customer of (data.rows as DataRecord[] | undefined) ?? []) {
          if (customer?.id || customer?.name) customers.set(customer.id ?? customer.name, customer);
        }
      }
      if (result.tool === "query_business_data" && data?.resource === "orders") {
        orders.push(...((data.rows as DataRecord[] | undefined) ?? []));
      }
    }

    if (!customers.size && !orders.length) return null;

    const riskLines: string[] = [];
    const actionLines: string[] = [];
    for (const order of orders) {
      const name = order.customer_name ?? order.customerName ?? "未知客户";
      const status = String(order.status ?? order.order_status ?? "未知状态");
      const amount = formatAmount(order.amount);
      if (/(合同|审批)/.test(status)) {
        riskLines.push(`${name} 的订单仍在「${status}」，金额${amount}，主要风险是合同或审批节点阻塞，影响签约确认和收入落地。`);
        actionLines.push(`推进 ${name} 的合同审批，明确卡点、负责人和预计完成时间。`);
      } else if (/(待发货|待交付|整备|发货)/.test(status)) {
        riskLines.push(`${name} 的订单处于「${status}」，金额${amount}，主要风险是交付节点延迟，可能影响客户体验和回款节奏。`);
        actionLines.push(`跟进 ${name} 的交付排期和发货准备，确认 ${order.expected_delivery ? `${order.expected_delivery} 前` : ""}是否能完成。`);
      } else {
        riskLines.push(`${name} 的订单状态为「${status}」，金额${amount}，需要继续跟踪状态变化。`);
      }
    }

    for (const customer of customers.values()) {
      if (customer.tier === "B" || /未签单|跟进中|待续签/.test(`${customer.sign_status ?? ""}${customer.follow_status ?? ""}${customer.renewal_status ?? ""}`)) {
        const name = customer.name ?? customer.id ?? "未知客户";
        const tags = [customer.tier ? `${customer.tier} 类` : null, customer.industry, customer.sign_status, customer.follow_status, customer.renewal_status]
          .filter(Boolean)
          .join(" / ");
        riskLines.push(`${name}（${tags}）仍需要经营推进，风险在于转化或续签不确定。`);
        actionLines.push(`为 ${name} 设定下一次跟进目标，优先确认决策人、预算、审批进度和续签意向。`);
      }
    }

    const dedupedRisks = uniqueLines(riskLines);
    const dedupedActions = uniqueLines(actionLines);
    if (!dedupedRisks.length) return null;

    return {
      answer: [
        `结论：你当前可访问 ${customers.size || "若干"} 个客户，已查到 ${orders.length} 条相关订单；主要风险集中在订单审批/交付推进和客户转化/续签不确定性。`,
        "",
        "关键风险：",
        ...dedupedRisks.map((line) => `- ${line}`),
        "",
        "建议动作：",
        ...dedupedActions.slice(0, 5).map((line) => `- ${line}`)
      ].join("\n"),
      artifacts: []
    };
  }
};

// ── 单工具答案 composers ──────────────────────────────────────────────────

export const QUERY_ORDER_COMPOSER: ReportComposerDefinition = {
  id: "core.query_order",
  matches({ toolResults }) {
    return toolResults.some((r) => r.tool === "query_order" && r.ok);
  },
  compose({ toolResults }) {
    const result = toolResults.find((r) => r.tool === "query_order" && r.ok);
    if (!result) return null;
    const order = result.data as DataRecord;
    const lines = [`客户「${order.customer_name}」最近订单 ${order.id} 当前状态为「${order.status}」，金额 ${order.amount} 元。`];
    if (order.expected_delivery) {
      lines.push(`预计交付时间是 ${order.expected_delivery}。`);
    }
    return { answer: lines.join("\n"), artifacts: [] };
  }
};

export const QUERY_CUSTOMER_COMPOSER: ReportComposerDefinition = {
  id: "core.query_customer",
  matches({ toolResults }) {
    return toolResults.some((r) => r.tool === "query_customer" && r.ok);
  },
  compose({ toolResults }) {
    const result = toolResults.find((r) => r.tool === "query_customer" && r.ok);
    if (!result) return null;
    const customer = result.data as DataRecord;
    return {
      answer: `客户「${customer.name}」属于 ${customer.tier} 类客户，行业为${customer.industry}，年度成交额为 ${customer.annual_revenue} 元。`,
      artifacts: []
    };
  }
};

export const LIST_MY_CUSTOMERS_COMPOSER: ReportComposerDefinition = {
  id: "core.list_my_customers",
  matches({ toolResults }) {
    return toolResults.some((r) => r.tool === "list_my_customers" && r.ok);
  },
  compose({ toolResults }) {
    const result = toolResults.find((r) => r.tool === "list_my_customers" && r.ok);
    if (!result) return null;
    const customers = Array.isArray((result.data as DataRecord)?.customers) ? (result.data as DataRecord).customers as DataRecord[] : [];
    if (customers.length === 0) {
      return { answer: "你当前没有可访问的客户。", artifacts: [] };
    }
    const lines = [`你当前可访问 ${customers.length} 个客户：`];
    for (const customer of customers) {
      lines.push(`- ${customer.name}（${customer.id}）：${customer.tier} 类客户，行业为${customer.industry}，年度成交额 ${customer.annual_revenue} 元。`);
    }
    return { answer: lines.join("\n"), artifacts: [] };
  }
};

export const QUERY_SALES_REPORT_COMPOSER: ReportComposerDefinition = {
  id: "core.query_sales_report",
  matches({ toolResults }) {
    return toolResults.some((r) => r.tool === "query_sales_report" && r.ok);
  },
  compose({ toolResults }) {
    const result = toolResults.find((r) => r.tool === "query_sales_report" && r.ok);
    if (!result) return null;
    const report = result.data as DataRecord;
    return {
      answer: `${report.department} 在 ${report.period} 的销售收入为 ${report.revenue} 元，pipeline 为 ${report.pipeline} 元。`,
      artifacts: []
    };
  }
};

/** 所有 core domain report composers */
export const CORE_REPORT_COMPOSERS: ReportComposerDefinition[] = [
  CUSTOMER_ORDER_RISK_COMPOSER,
  QUERY_ORDER_COMPOSER,
  QUERY_CUSTOMER_COMPOSER,
  LIST_MY_CUSTOMERS_COMPOSER,
  QUERY_SALES_REPORT_COMPOSER,
];

// ── helpers ──────────────────────────────────────────────────────────────

function formatAmount(value: unknown): string {
  return value === undefined || value === null || value === "" ? "未提供" : `${value} 元`;
}

function uniqueLines(lines: string[]): string[] {
  return Array.from(new Set(lines.filter(Boolean)));
}

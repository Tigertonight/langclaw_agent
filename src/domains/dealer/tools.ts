/**
 * Dealer 域工具定义。
 *
 * 包含 list_my_customers / query_customer / query_order / query_sales_report
 * 四个 dealer/CRM 业务工具，从 src/tools/business-tools.ts 迁移而来。
 *
 * 通用查询工具 query_business_data 仍保留在 engine 层（它是声明驱动、
 * 不挑业务的资源查询工具）。
 */

import { loadJson } from "../../data/load-json.js";
import { getResourceDataPath } from "../runtime-registry.js";
import type { ToolDefinition } from "../../types/agent-contracts.js";
import { defineTool, z, ToolResultBaseSchema } from "../../tools/zod-helpers.js";

type DataRow = Record<string, unknown>;

interface DealerToolContext {
  user: {
    id: string;
    name?: string;
    department?: string;
    permissions?: string[];
    accessible_customer_ids?: string[];
  };
}

function normalize(text: unknown): string {
  return String(text ?? "").trim();
}

async function findCustomerByName(customerName: unknown): Promise<DataRow | undefined> {
  const customers = await loadJson(getResourceDataPath("customers") ?? "data/customers.json") as DataRow[];
  const normalized = normalize(customerName);
  return customers.find((customer) => String(customer.name ?? "").includes(normalized) || normalized.includes(String(customer.name ?? "")));
}

export function createDealerTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "list_my_customers",
      description: "列出当前登录员工权限范围内可访问的客户列表。",
      metadata: {
        required_permissions: ["customer:read"],
        risk_level: "read",
        requires_confirmation: false,
        intents: ["data_query", "mixed"]
      },
      inputSchema: z.object({}).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(_args, context = {}) {
        const user = (context as DealerToolContext).user;
        const customers = await loadJson(getResourceDataPath("customers") ?? "data/customers.json") as DataRow[];
        const allowed = new Set(user.accessible_customer_ids ?? []);
        const matched = customers
          .filter((customer) => allowed.has(String(customer.id ?? "")))
          .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
        return {
          ok: true,
          tool: "list_my_customers",
          data: {
            user_id: user.id,
            customers: matched.map((customer) => ({
              id: customer.id,
              name: customer.name,
              tier: customer.tier,
              industry: customer.industry,
              department: customer.department,
              annual_revenue: customer.annual_revenue,
              owner_user_id: customer.owner_user_id
            }))
          }
        };
      }
    }),
    defineTool({
      name: "query_customer",
      description: "查询客户基础信息，例如客户等级、行业、负责人范围内的年度成交额。",
      metadata: {
        required_permissions: ["customer:read"],
        risk_level: "read",
        requires_confirmation: false,
        intents: ["data_query", "mixed"]
      },
      inputSchema: z.object({
        customer_name: z.string().min(1).max(80).describe("客户名称")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args) {
        const customer = await findCustomerByName(args.customer_name);
        if (!customer) {
          return { ok: false, tool: "query_customer", error: "not_found", message: "未找到该客户。" };
        }
        return {
          ok: true,
          tool: "query_customer",
          data: {
            id: customer.id,
            name: customer.name,
            tier: customer.tier,
            industry: customer.industry,
            department: customer.department,
            annual_revenue: customer.annual_revenue
          }
        };
      }
    }),
    defineTool({
      name: "query_order",
      description: "查询客户最近订单状态、金额和预计交付时间。",
      metadata: {
        required_permissions: ["order:read"],
        risk_level: "read",
        requires_confirmation: false,
        intents: ["data_query", "mixed"]
      },
      inputSchema: z.object({
        customer_name: z.string().min(1).max(80).describe("客户名称"),
        period: z.literal("latest").optional().describe("当前只支持 latest")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args) {
        const orders = await loadJson(getResourceDataPath("orders") ?? "data/orders.json") as DataRow[];
        const normalized = normalize(args.customer_name);
        const matched = orders
          .filter((order) => String(order.customer_name ?? "").includes(normalized) || normalized.includes(String(order.customer_name ?? "")))
          .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

        if (matched.length === 0) {
          return { ok: false, tool: "query_order", error: "not_found", message: "未找到该客户订单。" };
        }

        return {
          ok: true,
          tool: "query_order",
          data: matched[0]
        };
      }
    }),
    defineTool({
      name: "query_sales_report",
      description: "查询部门销售报表，只返回聚合指标。",
      metadata: {
        required_permissions: ["sales_report:read"],
        risk_level: "sensitive_read",
        requires_confirmation: false,
        intents: ["data_query", "mixed"]
      },
      inputSchema: z.object({
        department: z.string().min(1).max(80).describe("部门名称"),
        period: z.string().regex(/^\d{4}Q[1-4]$/).optional().describe("周期，例如 2026Q2")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context = {}) {
        const user = (context as DealerToolContext).user;
        const reports = await loadJson(getResourceDataPath("sales_reports") ?? "data/sales_reports.json") as DataRow[];
        const department = args.department ?? user.department;
        const period = args.period ?? "2026Q2";
        const report = reports.find((item) => item.department === department && item.period === period);
        if (!report) {
          return { ok: false, tool: "query_sales_report", error: "not_found", message: "未找到该部门报表。" };
        }
        return {
          ok: true,
          tool: "query_sales_report",
          data: report
        };
      }
    }),
  ];
}

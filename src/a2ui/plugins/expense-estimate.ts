import { businessSurface } from "../openui-bridge.js";
import { card, formatCurrency, readNumber, readPath, row, text } from "../builders/components.js";
import { ExpenseScenarioSchema } from "./schemas.js";
import type { SurfacePlugin } from "./types.js";
import type { A2UIComponentInstance } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";

export const expenseEstimatePlugin: SurfacePlugin<JsonObject> = {
  kind: "expense_estimate",
  extract: (ctx) => extractExpenseEstimate(ctx.record),
  build: (data, ctx) => ({
    surfaceId: `${ctx.surfacePrefix}_${ctx.runId}_expense_estimate`,
    root: "expense_estimate_root",
    data: {
      ...data,
      ...businessSurface("expense_estimate", "报销金额测算", data)
    },
    components: expenseEstimateComponents(data)
  })
};

function expenseEstimateComponents(data: JsonObject): A2UIComponentInstance[] {
  return [
    card("expense_estimate_root", ["expense_estimate_title", "expense_estimate_amounts", "expense_estimate_basis"]),
    text("expense_estimate_title", "### 报销金额测算"),
    row("expense_estimate_amounts", ["expense_claimed", "expense_eligible", "expense_exceeded"]),
    text("expense_claimed", `**${formatCurrency(data.claimed_amount)}**\n\n申报金额`),
    text("expense_eligible", `**${formatCurrency(data.eligible_amount)}**\n\n预计可报`),
    text("expense_exceeded", `**${formatCurrency(data.exceeded_amount)}**\n\n超标金额`),
    text("expense_estimate_basis", `依据：${String(data.policy_basis ?? "按当前制度标准测算")}`)
  ];
}

function extractExpenseEstimate(record: Record<string, unknown>): JsonObject | null {
  const answer = String(readPath(record, ["answer"]) ?? readPath(record, ["output", "answer"]) ?? "");
  const message = String(readPath(record, ["user_message"]) ?? readPath(record, ["output", "user_message"]) ?? "");
  const combined = `${message}\n${answer}`;
  if (!/报销|差旅|住宿|酒店|发票/.test(combined)) return null;

  // 1) 优先用结构化 scenario / tool_result（如果上游给了）
  const scenario = ExpenseScenarioSchema.safeParse(
    readPath(record, ["debug", "scenario"]) ??
    readPath(record, ["output", "debug", "scenario"]) ??
    readPath(record, ["scenario"])
  );
  const structuredClaimed = scenario.success ? readNumber(scenario.data.claimed_amount) : null;
  const cityFromScenario = scenario.success && typeof scenario.data.city === "string" ? scenario.data.city : "";

  // 2) 兜底正则——只在没有结构化数据时使用
  const claimed = structuredClaimed ?? extractMoney(message) ?? extractMoney(answer);
  if (!claimed) return null;

  const isFirstTier = /(?:一线|北京|上海|广州|深圳)/.test(cityFromScenario || message);
  const standard = isFirstTier ? 600 : 450;
  const eligible = Math.min(claimed, standard);
  const exceeded = Math.max(0, claimed - standard);

  return {
    claimed_amount: claimed,
    eligible_amount: eligible,
    exceeded_amount: exceeded,
    currency: "CNY",
    policy_basis: scenario.success && scenario.data.policy_basis
      ? scenario.data.policy_basis
      : `住宿标准 ${standard} 元/晚；超标部分需说明并审批。`,
    status: exceeded > 0 ? "exceeded" : "eligible"
  };
}

function extractMoney(text: string): number | null {
  // 优先匹配带"元/块"的数字，否则取靠近"花了/报销/发票"的金额，避免抓到天数等无关数字
  const withUnit = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|人民币)/);
  if (withUnit) {
    const value = Number(withUnit[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const nearKeyword = text.match(/(?:花了|花费|报销|发票|金额|总计|合计)\s*(\d+(?:\.\d+)?)/);
  if (nearKeyword) {
    const value = Number(nearKeyword[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}


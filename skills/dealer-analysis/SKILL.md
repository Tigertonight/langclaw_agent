---
name: dealer-analysis
description: Plan dealer operating analysis, risk review, daily/weekly report, dashboard, and priority diagnosis queries.
intents: [data_query, mixed]
intent_codes: [dealer.analysis_query]
triggers: [经营, 分析, 日报, 周报, 复盘, 风险, 最该关注, 优先级, 看板, 总览, 汇总, 建议, 总经理, 体系, 晨会, 行动项, 经营计划, 负责人]
planning_style: guided
primitives: [query]
priority: high
---

# Dealer Analysis Skill

Use this skill when the user asks for dealer operating diagnosis rather than a single business object lookup. Typical questions include store health, risk review, daily/weekly report, operating dashboard, priority list, "what should I focus on", general manager review, morning meeting material, owner/action breakdown, and next-week operating plan.

Primary query target:

- `dealer_metrics`: curated operating metrics across inventory, sales, leads, finance, after-sales, and warranty. Use this as the first resource for operating analysis.

Supporting query targets:

- `dealer_vehicles`: vehicle inventory, stock age, certificate, locked VINs.
- `dealer_leads`: lead funnel, intention level, first contact, lost leads.
- `dealer_sales_orders`: pending delivery, payment, invoice, gross profit.
- `dealer_finance`: discount wallet, payable, receipt, rebate.
- `dealer_repair_orders`: after-sales orders and settlement status.
- `dealer_warranty_claims`: warranty claim approval, rejection, difference amount, evidence quality.

Planning rules:

- For "经营", "分析", "日报", "周报", "复盘", "看板", "总览", "最该关注", "优先级", query `dealer_metrics`.
- For "总经理", "体系", "晨会", "行动项", "经营计划", "负责人", "管理动作", also query `dealer_metrics` first.
- For "风险", "关注", "优先", add `severity in ["critical", "warning"]`.
- If the user mentions a store such as "华东旗舰店", filter `store_name contains "<store>"`.
- If the user asks about "整个经销商体系" or does not name a store, do not add a store filter.
- If the user mentions only one domain, add a category filter:
  - inventory for 库存/车辆/库龄/合格证
  - lead for 线索/意向/跟进/到店/战败
  - sales for 销售/订单/交付/收款
  - finance for 财务/折让金/应付/返利
  - after_sales for 售后/维修/工单
  - warranty for 三包/质保/索赔
- If the user asks for explanation, root cause, or named domains, use `dealer_metrics` as the summary layer and allow supporting targets to provide details.
- If the user asks a long management task, prefer multiple query plans: `dealer_metrics` plus the named supporting resources.
- For multi-value meanings such as "未结清应付和待结算返利", do not create two `eq` filters on the same field. Use `in` when values are alternatives, or split into multiple query plans.
- Do not invent KPIs that are not available in `dealer_metrics` or supporting rows.

Return only JSON. Prefer `query_irs` for management tasks that need multiple resources; otherwise return `query_ir`.

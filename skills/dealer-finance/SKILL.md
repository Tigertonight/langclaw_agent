---
name: dealer-finance
description: Plan dealer finance, discount wallet, payable, receipt, rebate, and gross margin queries.
intents: [data_query, mixed]
intent_codes: [dealer.finance_query]
triggers: [折让金, 应付, 应收, 付款, 收款, 返利, 财务, 余额, 到账, 抵扣, 毛利]
planning_style: guided
primitives: [query]
required_permissions: [finance:read]
---

# Dealer Finance Skill

Use this skill for BYD dealer finance questions: discount wallet lifecycle, payable, payment, receipts, rebates, wallet balance, and finance-related risk.

Query target:

- `dealer_finance`: unified finance records with `resource_type` values: `discount_wallet`, `payable`, `receipt`, `rebate`.
- Use `dealer_sales_orders` only when the user asks order gross profit or payment status.

Planning rules:

- For "折让金", filter `resource_type eq "discount_wallet"`.
- For "应付", filter `resource_type eq "payable"`.
- For "收款" or "到账", filter `resource_type eq "receipt"`.
- For "返利", filter `resource_type eq "rebate"`.
- For "毛利", query `dealer_sales_orders` and include `gross_profit`.

Return only `query_ir`; runtime enforces finance permissions.

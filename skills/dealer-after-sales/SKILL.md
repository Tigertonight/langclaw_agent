---
name: dealer-after-sales
description: Plan dealer after-sales repair order and warranty claim queries.
intents: [data_query, mixed]
intent_codes: [dealer.after_sales_query, dealer.warranty_query]
triggers: [售后, 维修, 保养, 工单, 接待, 质检, 结算, 三包, 质保, 索赔, 故障码, 核准金额]
planning_style: guided
primitives: [query]
---

# Dealer After-Sales Skill

Use this skill for after-sales operations: repair appointments, reception, repair orders, quality check, settlement, warranty claims, claim approval, and evidence sufficiency.

Query targets:

- `dealer_repair_orders`: service appointment, reception, repair order, status, receivable amount, advisor.
- `dealer_warranty_claims`: warranty/three-guarantee claim status, fault code, claimed amount, approved amount, evidence status.

Planning rules:

- For "维修", "保养", "售后工单", "待结算", query `dealer_repair_orders`.
- For "三包", "质保", "索赔", "厂家审核", "核准金额", "故障码", query `dealer_warranty_claims`.
- For "被拒" or "拒绝", filter `claim_status eq "已拒绝"`.
- For "差异", filter `difference_amount gte 1`.

Return only `query_ir`.

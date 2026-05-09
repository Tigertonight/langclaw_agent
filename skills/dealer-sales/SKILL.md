---
name: dealer-sales
description: Plan dealer lead funnel, intention, lost-sale, sales order, delivery, and gross-profit queries.
intents: [data_query, mixed]
intent_codes: [dealer.lead_query, dealer.order_query]
triggers: [线索, 意向, 跟进, 到店, 战败, 漏斗, 销售订单, 锁车, 合同, 交付, 毛利, 按揭, 全款]
planning_style: guided
primitives: [query]
---

# Dealer Sales Skill

Use this skill for dealer front-office sales work: lead funnel, follow-up quality, intention level, lost-sale reasons, sales orders, locked VINs, payment status, delivery status, and gross profit.

Query targets:

- `dealer_leads`: leads, source, intention level, owner, follow-up count, visits, lost-sale reason, converted order.
- `dealer_sales_orders`: sales order, locked VIN, order type, payment, invoice, delivery, final price, gross profit.

Planning rules:

- For "线索", "漏斗", "意向", "跟进", "到店", "战败", query `dealer_leads`.
- For "销售订单", "锁车", "合同", "交付", "收款状态", "开票", "成交价", "毛利", "按揭", "全款", query `dealer_sales_orders`.
- For "H级", filter `intention_level eq "H"`.
- For "战败", filter `status eq "战败"`.
- For "待交付", filter `delivery_status contains "待"`.
- For vehicle series, filter `series contains "<series>"`.

Return only `query_ir`.

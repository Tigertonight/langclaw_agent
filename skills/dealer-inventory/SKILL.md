---
name: dealer-inventory
description: Plan dealer vehicle inventory, inbound, quota, PDI, certificate, and stock-age queries.
intents: [data_query, mixed]
intent_codes: [dealer.inventory_query]
triggers: [整车, 车辆, VIN, 库存, 库龄, 在途, 配额, PDI, 合格证, 展车, 试驾车]
planning_style: guided
primitives: [query]
---

# Dealer Inventory Skill

Use this skill for AI-native dealer inventory questions: vehicle stock, VIN lifecycle, inbound orders, quota availability, stock-age risk, certificates, showroom cars, test-drive cars, and PDI status.

Query targets:

- `dealer_vehicles`: current vehicle master data and stock-age risk.
- `dealer_inbounds`: inbound orders and customer custom orders.
- `dealer_quotas`: monthly model quota and available commitment quantity.
- `dealer_stores`: store master data and capacity.

Planning rules:

- For "库龄", "库存风险", "超龄库存", query `dealer_vehicles`, usually filter `stock_warning_level in ["关注","预警","紧急"]`, sort by `stock_age_days desc`.
- For "在途", "到店", "客户定制", "交期", query `dealer_inbounds`.
- For "配额", "可承诺", "没配额", query `dealer_quotas`.
- For store names or regions, filter `store_name contains "<store or region>"`.
- For vehicle series such as 汉、宋L、海豹、秦PLUS、唐、元PLUS、腾势N7, filter `series contains "<series>"`.

Return only `query_ir`. Do not call tools directly.

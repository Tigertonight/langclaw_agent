---
name: gross-margin-attribution
description: 把已查到的销售订单 rows 按 车系/渠道/门店 维度做毛利率归因分析，输出一段管理层口吻的归因文案，回答『谁赚谁亏 / 为什么 / 该看哪一刀』。已经通过 intent.* 拉到了订单或聚合行级数据，需要写一段对比/归因/解释口吻的分析时调用；用户问『为什么毛利掉了 / 哪个车系最赚钱 / 是渠道还是车型的问题』这类需要"分维度比较"的口吻时调用。不要在还没拉到数据时调用，也不要用于单一指标查询（那种走 intent.* 直接答即可）。
---

# 毛利率归因分析（gross-margin-attribution）

中文展示名：毛利率归因分析。

这个 skill 不查数据、不算数。它把已经准备好的 rows（销售订单或聚合记录）按指定维度比较毛利率高低，写成一段管理层视角的归因分析。

## When to use

- 已经通过 intent.dealer.aggregate.sales_orders 或 intent.dealer.query.sales_orders 拉到了订单/聚合数据，需要写一段"谁赚谁亏 + 为什么"的分析
- 用户问『为什么毛利下降』『哪个车系最赚钱』『是车型问题还是渠道问题』这类需要分维度比较的问题
- 不要用在单维度的单纯查询（"本月毛利率多少" 这种走 intent_query 直接答）
- 不要在还没拉到 rows 的情况下调用本 skill

## Inputs

- `rows` (array, 必填)：行级数据，每行至少含 series/model/channel/store 之一作为维度键，以及 final_price + gross_profit 用于算毛利率
- `dim` (string, 必填)：归因主维度。取值：series（车系）/ channel（渠道）/ store（门店）/ model（具体车型）
- `compare` (string, 选填)：对比维度（让 LLM 关注的副维度），例如 dim=series 时 compare=channel 表示"按车系分组的同时也观察渠道差异"
- `period_label` (string, 选填)：用于文案点题的口径说明，例如 "2026-05 至今"

返回：归因分析文本（中文，3 段，含"整体面 / 高低对比 / 归因建议"三部分）。

## 输出风格

- 严格 3 段，每段 ≤ 4 行。
- 第 1 段：整体面 — 用 1 个汇总数字定调（整体毛利率 / 涉及 N 笔订单 / 总成交额）。
- 第 2 段：高低对比 — 在主维度下点出最赚的 1 项 与 最亏的 1 项，给出它们各自的毛利率和样本量。
- 第 3 段：归因建议 — 给出 1 条最值得追的归因方向（"是车型问题还是渠道问题"），可附 1 条可执行动作。
- 不要表格、不要列表、不要 markdown 标题、不要"我"或"AI"字样。

## 调用规约

调用 skill.gross-margin-attribution 时：

- `rows`：传 intent.* 调用得到的 rows（最好是 sales_orders.query 的明细，或 sales_orders.aggregate 的分组结果）。
- `dim`：选 1 个主分析维度。最常用 `series`。
- `compare`：选填；如果用户的话里同时提到两个维度（"看看车系，也看看渠道"），就把第二个填进来。
- `period_label`：选填；用于在文案里点出统计口径，例如 "本月（2026-05 至今）"。

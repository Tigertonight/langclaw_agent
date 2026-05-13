---
id: summarize-alert
name: 经营告警简报
description: 把已经查到的 rows（库存/财务/工单等）和告警类型，写成一段简明的经营告警简报。给店总/区域负责人用。
when_to_use:
  - 已经通过 intent.* 拉到了具体行级数据，需要把这些数据浓缩成一两段汇报话术
  - 用户问「压力大不大 / 风险高不高 / 现状怎么样」这类需要"评判+建议"的口吻
  - 不要在还没拉到数据时调用本 skill
io:
  args:
    rows:
      type: array
      required: true
      description: 行数据（已经过过滤），可以拼接多家门店；每行可有 store/series/model/days_in_stock/cost/amount 等字段
    alert_kind:
      type: string
      required: true
      enum: [inventory_pressure, finance_overdue, repair_overdue, warranty_diff]
      description: 告警类别，决定写作侧重点
    extra_metrics:
      type: object
      required: false
      description: 由 tool.safe_compute 算出的派生指标，例如 weighted_age / overdue_ratio。会出现在简报正文。
  returns: 简报文本（中文，2-4 段，含"现状/风险点/建议"三部分）
---

# 经营告警简报 skill

这个 skill 不查数据、不算数。它把已经准备好的 rows 和派生指标，按"经营简报"的语气写成给管理层的告警材料。

## 输出风格

- 2 到 4 段，每段不超过 3 行。
- 第 1 段：现状 — 用 1-2 个具体数字定调（**门店 / 总数 / 关键指标**）。
- 第 2 段：风险点 — 指出 1-2 个最该警惕的细节（库龄最长的车、金额最大的应付）。
- 第 3 段：建议动作 — 给 1 条可立即执行的动作（哪台车降价、哪个客户先收款）。
- 不要出现"我"或"AI"字样；不要出现表格；不要再列 markdown 列表。

## 调用规约

调用 skill.summarize_alert 时，把以下材料尽量备齐：

- `rows`：传你最近一次 intent.* 调用得到的 rows（可以 concat 多家门店）。
- `alert_kind`：根据问题选 `inventory_pressure` / `finance_overdue` / `repair_overdue` / `warranty_diff`。
- `extra_metrics`：把 tool.safe_compute 的输出（例如加权库龄、逾期占比）放进来，否则简报数据会偏笼统。

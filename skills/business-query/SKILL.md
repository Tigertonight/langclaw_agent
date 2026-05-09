---
name: business-query
description: Convert flexible business data questions into Query IR, then compile it into safe query_business_data tool calls.
intents: [data_query, mixed]
triggers: [客户, 订单, 销售额, 成交额, pipeline, 签单, 续签, 跟进, 部门, 员工, 上级, 下级]
planning_style: guided
primitives: [query]
---

# Business Query Skill

Use this skill when the user asks flexible questions about customers, orders, sales reports, organization directory, employees, departments, counts, filters, rankings, or status.

Do not enumerate user phrasing or business scenarios. Translate natural language into a structured Query IR first, then compile the IR into the generic `query_business_data` tool request.

Query IR should capture:

- `domain`: sales, organization, finance, or other business domain.
- `target`: customers, orders, sales_reports, employees, or departments.
- `entity`: resolved customer, employee, department, or other business entity.
- `operation`: search, aggregate, compare, rank, or lookup.
- `filters`: field/operator/value constraints.
- `metrics`: count/sum/avg when the user asks for quantity or statistics.
- `sort`, `fields`, and `limit`.
- `needsClarification`: short question when required entities are missing.

The compiler is responsible for turning Query IR into tool arguments. The tool is responsible for permission enforcement and data execution.

Always keep the current user's permissions and accessible customers in scope. If the question is ambiguous, ask a short clarification instead of guessing a destructive or broad query.

For arithmetic, counts, ratios, sorting, grouping, and date calculations, use deterministic tool execution or safe calculation. Do not let the model estimate numbers.

When answering, explain the result in business language and mention important filters that affected the answer.

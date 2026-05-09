---
name: leave-records
description: Let employees query their own leave history and leave counts from the local attendance record table.
intents: [data_query]
intent_codes: [attendance.leave_query]
triggers: [请假记录, 请假历史, 休假记录, 休假历史, 我的请假, 请了几次假]
planning_style: guided
primitives: [query]
required_permissions: [leave:submit]
---

# Leave Records Skill

Use this skill when the user wants to view or count leave records in the attendance table.

Plan a `query_ir` for the `leave_requests` resource. The runtime will enforce permissions and row scope; do not bypass that with broad filters.

Scope rules:

- If the user asks for "my leave records", filter `applicant_user_id eq "__CURRENT_USER__"`.
- If a manager asks for team or subordinate leave records, filter `applicant_user_id in "__CURRENT_USER_REPORTS__"`.
- If an authorized manager asks for company-wide leave records ("全公司", "整个公司", "所有员工"), filter `applicant_user_id in "__ALL_ORG_USERS__"`; the runtime will only expand this for users with organization read scope.
- If a manager names a specific employee, filter by `applicant_name contains "<employee name>"`; the runtime will restrict rows to the current user's reporting chain.
- If the user asks for a named employee but does not have access, the runtime will return no rows or permission denial.

Query rules:

- Use `operation: "aggregate"` when the user asks "几次", "多少次", "数量", or "统计".
- Use `operation: "search"` when the user asks for records, history, detail, list, "最近", or a named employee.
- For recent records, sort by `start_time desc` or `submitted_at desc` and set a small limit such as 20.
- For relative time such as "最近三个月", use the runtime current date to generate both `start_time gte "YYYY-MM-DD"` and `start_time lte "<today>"` filters.
- Support filters for `leave_type`, `start_time`, `submitted_at`, `applicant_name`, and `applicant_user_id`.

Return only a `query_ir`; do not call tools directly from the skill text.

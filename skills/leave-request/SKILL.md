---
name: leave-request
description: Guide controlled leave request workflows with slot collection, confirmation, and submit tool usage.
intents: [leave_request]
triggers: [请假, 休假, 年假, 病假, 事假, 调休]
planning_style: strict_workflow
primitives: [act]
---

# Leave Request Skill

Use this skill for the controlled leave application workflow.

Required slots:

- leave type
- start time
- end time or duration
- reason

Collect missing slots over multiple turns. Before submitting, show the full request and require explicit confirmation. Only call `submit_leave_request` after confirmation.

If the user says they no longer want to apply, cancel the workflow. If the user asks about leave policy rather than submitting a request, route to the knowledge QA path.

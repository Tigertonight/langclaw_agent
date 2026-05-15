---
title: Intent Router Implementation Report
branch: codex/intent-router
status: current architecture notes
---

# Overview

Intent Router is now the default entrypoint for both blocking and streaming chat paths.
The runtime no longer falls back to the old local classifier for business routing.

Current dispatch shape:

```text
IntentRouter
  -> manifest validation
  -> confidence threshold / params schema validation
  -> execution_class
  -> controlled_execution | autonomous_planning
```

# Current Handlers

| handler | execution_class | purpose |
|---|---|---|
| `chitchat` | `controlled_execution` | Low-risk direct interaction. |
| `intent_query` | `controlled_execution` | Registered query/aggregate intent to deterministic tool call. |
| `knowledge_lookup` | `controlled_execution` | Permission-filtered knowledge retrieval. |
| `workflow` | `controlled_execution` | Controlled multi-turn operations such as leave requests. |
| `agentic` | `autonomous_planning` | Multi-step cross-intent planning. |

# Routing Policy

- Only registered `data/intent-codes/*.json` codes are accepted.
- Manifest `handler_type` is authoritative.
- Low confidence below `confidence_threshold` downgrades to `general/agentic`, except low-risk chitchat.
- Params are normalized and validated against `params_schema`.
- Missing required params or invalid enum/type values downgrade to `general/agentic` when available.
- If no model key is configured, only very small local chitchat can be answered; business routing fails closed.

# Query Mapping

Simple deterministic filters should live in manifest `filter_mapping`.

`IntentQueryHandler` supports small reusable transforms:

- `time_range_to_iso`
- `month_token_or_time_range`
- `clean_fault_category`
- `infer_leave_type`
- `leave_scope`
- `overdue_repair_filters`

Domain-specific logic that cannot be represented as mapping should stay small and explicit.

# Verification

Use:

```bash
npm run config:check
npm run smoke
npm run arch:smoke
npm run session:smoke
npm run eval:router
```

This environment may not always have `npm` on PATH; the scripts are still the project-level
verification contract.

# Legacy Notes

The old local classifier, query parser/compiler, and free-agent loop are retained for compatibility
and historical evals, but new capabilities should not extend those paths.

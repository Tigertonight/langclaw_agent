# Agent Architecture

## Current Runtime Shape

The project now uses Intent Router as the default entrypoint. Legacy local classification and
free-agent execution are no longer on the orchestrator main path.

```text
Channel / Web / WeCom
  -> Session Runtime
  -> UserContextResolver
  -> IntentRouter
     -> registered intent manifest validation
     -> confidence threshold / params schema validation
     -> execution_class normalization
  -> controlled_execution OR autonomous_planning
     -> chitchat
     -> intent_query
     -> knowledge_lookup
     -> workflow
     -> agentic
  -> ToolRegistry / KnowledgeBase / WorkflowRunner
  -> answer + artifacts + traces
  -> Audit Log / Session Store
```

## Execution Classes

`controlled_execution` is for bounded tasks that should complete predictably:

- `chitchat`: low-risk direct answers.
- `intent_query`: one registered intent plus params becomes one deterministic tool call.
- `knowledge_lookup`: policy and handbook retrieval through permission-filtered knowledge tools.
- `workflow`: controlled multi-turn operations such as leave requests.

`autonomous_planning` is for open-ended tasks:

- `agentic`: multi-step tool calling across `intent.*`, `tool.*`, and `skill.*`.

The router may downgrade a route to `general/agentic` when confidence is below the manifest
threshold or params fail schema validation.

## Intent Manifests

Intent manifests in `data/intent-codes/*.json` are the source of truth for:

- `intent_code`
- `execution_class`
- `handler_type`
- `params_schema`
- `confidence_threshold`
- `tool_binding`
- `filter_mapping`
- `metric_definitions`
- permissions

Simple query filters should live in `filter_mapping`. `IntentQueryHandler` only keeps small
transforms and compatibility hooks for domain semantics that cannot be expressed as direct field
mapping.

## Legacy Components

The following modules are retained for compatibility, eval history, and future reference, but are
not the primary orchestrator path:

- `src/runtime/free-agent-loop.js`
- `src/runtime/agentic-loop.js`
- `src/query/query-parser.js`
- `src/query/query-compiler.js`
- older local planning logic in `src/llm/local-llm.js`

New dealer and enterprise-data capabilities should prefer intent manifests plus controlled
handlers instead of extending these legacy paths.

## External Adapters

External systems should stay behind normalized adapters:

- Enterprise WeChat behind `UserContextResolver`.
- Tencent Docs behind `DocumentSource`.
- Business systems behind `ToolRegistry` tools.

The agent core should not depend directly on external platform SDKs.

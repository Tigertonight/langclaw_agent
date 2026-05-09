# Agent Architecture

## Current Phase

The project is now in a first-stage transition from `intent-first workflow + tool call`
to a more OpenClaw-like shape:

```text
Channel / Web / WeCom
  -> Session Runtime
  -> UserContextResolver
  -> Agent Core
     -> classifyIntentNode
     -> skill selection
     -> strict workflow skill OR open agent loop
     -> primitive-backed execution
     -> answer / artifact output
  -> Audit Log
```

The current implementation is intentionally hybrid:

- intent classification is still used as a routing signal
- skill runtime is now the primary execution selector
- workflow scenarios remain for strict enterprise operations
- primitive registry is added as a compatibility layer above legacy tools

## First-Stage Runtime Shape

```text
message
  -> resolve user / enterprise context / session
  -> classify intent
  -> select skill
  -> if strict_workflow:
       run scenario workflow
     else:
       run free agent loop
  -> answer
```

Current primitive set:

- `query`
- `retrieve`
- `act`
- `artifact`

At this stage, primitives are not yet the only execution path. Some of them still adapt to
legacy tools such as `query_business_data` and `submit_leave_request`.

## LangGraph Migration Map

Current node functions live in `src/agent/nodes.js`:

- `classifyIntentNode`
- `retrieveKnowledgeNode`
- `planToolCallsNode`
- `executeToolsNode`
- `generateAnswerNode`

Current scenario handlers live in `src/scenarios/`. `leave-request.js` should become a LangGraph subgraph with state:

```json
{
  "active_intent": "leave_request",
  "slots": {},
  "missing_slots": [],
  "step": "collecting"
}
```

## External Adapters

- Enterprise WeChat: implement a real directory adapter behind `UserContextResolver`.
- Tencent Docs: implement a real document source behind `DocumentSource`.
- Business systems: replace mock tool `execute` implementations with API/CLI adapters.

The agent core should continue to depend on normalized `UserContext`, `DocumentSource`, and `ToolRegistry`, not external platform SDKs directly.

## Planned Next Step

The next refactor step should consolidate more legacy tools into primitives:

- business data access -> `query`
- workflow writes -> `act`
- knowledge fetch -> `retrieve`
- report generation -> `artifact`

After that, the remaining scenarios can be gradually rewritten as strict workflow skills.

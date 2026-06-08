# 当前项目全貌与功能架构

分支：`feat/integration-all`

本项目是一个面向企业内部业务场景的 TypeScript Agent Runtime。当前代码已经从“单一业务 Agent”演进为一套可扩展运行时：多渠道入口统一进入 `BusinessQueryEngine`，再由 `EngineHost` 组装路由、Handler、工具、技能、业务域、记忆、任务、Cron、演化和观测能力。

## 项目全貌图

![Enterprise Agent 项目全貌](assets/current-project-architecture-overview.png)

## 总体分层架构

```mermaid
flowchart TB
  subgraph Entry["入口与渠道层"]
    HTTP["HTTP Server\n/api/chat / SSE / A2UI"]
    CLI["CLI\nnpm run chat"]
    Gateway["EnterpriseGateway\nWeb / WeCom / Feishu / DingTalk / Webhook / Cron"]
  end

  subgraph Host["EngineHost 运行时组合层"]
    App["createApp()\n加载 env + integrations"]
    Engine["EngineHost\nPort/Adapter 组合器"]
    Packs["DomainPack Loader\ncore / dealer / attendance / retail-demo"]
    MCP["MCP Registry\n外部工具注入"]
  end

  subgraph Runtime["对话生命周期层"]
    QueryEngine["BusinessQueryEngine\nresolve_user -> context -> orchestrator -> evolution"]
    Hooks["RuntimeHooks\ntranscript / metrics / prompt authority / evolution"]
    Orchestrator["SimpleWorkflowOrchestrator\nrun / runStream"]
  end

  subgraph Decision["决策与执行层"]
    Router["IntentRouter\ncommand -> deterministic -> LLM JSON route"]
    Handlers["Handlers\nintent_query / chitchat / agentic"]
    Skills["SkillRuntime\nFileSystemSkillLoader + SkillSelector"]
    Tools["ToolRegistry\npermission / confirmation / timeout / retry"]
  end

  subgraph Business["业务域与数据层"]
    Domain["DomainRegistry\nresources / intents / tools / rules / plugins"]
    Query["QueryAdapterRegistry\n结构化业务查询"]
    Resources["ResourceRegistry\ndata/*.json + field labels"]
    KB["LocalKnowledgeBase\nknowledge docs / Tencent Docs mock-real"]
  end

  subgraph State["状态、治理与演化层"]
    Session["SessionStore\n用户 workspace 会话"]
    Transcript["TranscriptStore\nJSONL 事件轨迹"]
    Memory["Memory Tools / Memory Index\n用户记忆与检索"]
    TaskCron["TaskStore + UserCronStore\n任务与自动化"]
    Evolution["EvolutionRuntime\nsignal / judge / skill-memory iteration"]
    Metrics["MetricsCollector / Observability\nmetrics + logs"]
  end

  HTTP --> App
  CLI --> App
  Gateway --> QueryEngine
  App --> Engine
  Engine --> Packs
  Engine --> MCP
  Engine --> QueryEngine
  QueryEngine --> Hooks
  QueryEngine --> Orchestrator
  Orchestrator --> Router
  Router --> Handlers
  Handlers --> Skills
  Handlers --> Tools
  Tools --> Domain
  Domain --> Query
  Domain --> Resources
  Tools --> KB
  QueryEngine --> Session
  Hooks --> Transcript
  Tools --> Memory
  Tools --> TaskCron
  QueryEngine --> Evolution
  Hooks --> Metrics
```

## 单轮消息处理链路

```mermaid
sequenceDiagram
  autonumber
  participant U as User / Channel
  participant G as HTTP or EnterpriseGateway
  participant QE as BusinessQueryEngine
  participant UC as UserContextResolver
  participant EC as EnterpriseContextProvider
  participant O as SimpleWorkflowOrchestrator
  participant R as IntentRouter
  participant H as Handler
  participant T as ToolRegistry
  participant D as DomainPack / Data / KB
  participant S as Transcript / Session / Evolution

  U->>G: message
  G->>QE: submitMessage / submitStream
  QE->>UC: resolve user, role, permissions
  QE->>S: load session + append turn_start
  QE->>EC: load enterprise context
  QE->>O: run message
  O->>R: route intent
  R-->>O: Route(intent_code, handler_type, params)
  O->>H: execute selected handler
  H->>T: execute governed tools when needed
  T->>T: permission, confirmation, schema, timeout, retry
  T->>D: query resource / knowledge / sandbox / cron / memory
  D-->>T: tool result / evidence
  T-->>H: governed result
  H-->>O: answer + trace + A2UI
  O-->>QE: output
  QE->>S: query_engine_summary + usage + evolution signal
  QE-->>G: answer, trace, context_budget, A2UI
  G-->>U: deliver response
```

## EngineHost 装配关系

```mermaid
flowchart LR
  EngineHost["EngineHost"]

  EngineHost --> Infra["InfraPort\nLLM / Hooks / Transcript / Metrics / Evolution"]
  EngineHost --> Knowledge["KnowledgePort\nDocumentSource / LocalKnowledgeBase"]
  EngineHost --> Storage["StoragePort\nPendingActionStore / SessionStore"]
  EngineHost --> Domain["DomainPort\nDomainRegistry / ResourceRegistry / QueryAdapterRegistry"]
  EngineHost --> Tool["ToolPort\nToolRegistry / PrimitiveRegistry"]
  EngineHost --> Skill["SkillPort\nSkillRegistry / Loader / Runtime / ScenarioRouter"]
  EngineHost --> User["UserContextPort\nWeComDirectory or Mock + Permissions"]
  EngineHost --> Routing["RoutingPort\nIntentRegistry / IntentRouter"]
  EngineHost --> Handler["HandlerPort\nIntentQuery / Chitchat / Agentic"]
  EngineHost --> Messaging["MessagingPort\nConsole / WeCom message gateway"]
  EngineHost --> Cron["CronPort\nUserCronStore / AgentCronJobRunner"]
  EngineHost --> Orchestrator["OrchestratorPort\nSimpleWorkflowOrchestrator / BusinessQueryEngine"]

  Infra --> Tool
  Knowledge --> Tool
  Storage --> Tool
  Domain --> Tool
  Tool --> Skill
  Infra --> Routing
  Domain --> Routing
  Routing --> Handler
  Tool --> Handler
  Skill --> Handler
  Handler --> Cron
  Messaging --> Cron
  Infra --> Orchestrator
  Knowledge --> Orchestrator
  Storage --> Orchestrator
  Tool --> Orchestrator
  Skill --> Orchestrator
  User --> Orchestrator
  Routing --> Orchestrator
  Handler --> Orchestrator
```

## DomainPack 扩展机制

```mermaid
flowchart TB
  Discover["discoverDomainPacks()\n扫描 src/domains/*/domain-pack"]
  Validate["validateAndFilterPacks()\nAPI version + diagnostics"]
  Registry["DomainRegistry.initialize()\n拓扑排序 + init + 声明式收集"]

  subgraph Pack["一个 DomainPack 可声明"]
    Intents["intent manifests"]
    Commands["commands"]
    Rules["deterministic rules / extractors"]
    Resources["resources / field labels"]
    QueryAdapters["query adapters / filter transforms"]
    Tools["tools / permission rules"]
    Surfaces["A2UI surfaces"]
    Plugins["runtime plugins"]
  end

  Targets["分发到运行时注册表\nIntentRegistry / CommandRegistry / ResourceRegistry / QueryAdapterRegistry / ToolRegistry / RuntimeHooks"]

  Discover --> Validate --> Registry
  Registry --> Pack
  Pack --> Targets
```

## 当前主要功能域

| 层级 | 关键模块 | 职责 |
|---|---|---|
| 入口 | `src/server/http.ts`, `src/cli.ts`, `src/gateway/*` | HTTP、SSE、A2UI、CLI、多 IM/Webhook/Cron 渠道接入 |
| 运行时 | `src/app.ts`, `src/engine/host/*`, `src/runtime/*` | 应用启动、EngineHost 装配、QueryEngine 生命周期、Hooks、上下文组装 |
| 决策 | `src/router/*`, `data/intent-codes/*` | 命令、确定性规则、LLM 意图路由、参数校验与降级 |
| 执行 | `src/handlers/*`, `src/agent/*`, `src/agentic/*` | 结构化查询、闲聊、自主规划、多步骤工具调用、子 Agent |
| 工具 | `src/tools/*`, `src/sandbox/*`, `src/mcp/*` | 工具注册、权限治理、确认流、重试超时、沙箱、MCP 外部工具 |
| 技能 | `src/skills/*`, `workspace/skills/*` | Skill 注册、选择、严格工作流、Agentic skill view |
| 业务域 | `src/domains/*`, `src/resources/*`, `src/query/*` | core、dealer、attendance、retail-demo 等业务能力声明和查询适配 |
| 知识 | `src/rag/*`, `docs/knowledge/*` | 本地知识库、腾讯文档 mock/real source、制度问答 |
| 状态 | `src/transcript/*`, `src/memory/*`, `src/tasks/*`, `src/cron/*` | 会话轨迹、记忆、任务、高水位、用户自动化 |
| 治理 | `src/evolution/*`, `src/security/*`, `src/eval/*` | 演化闭环、鉴权限流观测、回归/冒烟验证 |

## 一句话总结

当前分支的架构重心是 `EngineHost + DomainPack + ToolRegistry + BusinessQueryEngine`：`EngineHost` 负责把运行时能力组装起来，`DomainPack` 负责让业务能力可插拔，`ToolRegistry` 负责把所有执行能力纳入权限和治理，`BusinessQueryEngine` 负责把每一轮消息变成可追踪、可压缩、可演化的完整生命周期。

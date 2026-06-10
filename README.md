# Enterprise Agent — 汽车经销垂类 · Claude Code 级 Agent 框架

> 面向汽车 4S 店内部使用的企业级 Agent，对标 **Claude Code / OpenClaw / Hermes Agent**，覆盖从意图路由到多 Agent 协作的完整生命周期。

> 📦 **要部署上线？** 看 [DEPLOY.md](DEPLOY.md) — 含本地 / 测试 / 生产三档 runbook、反代配置、验收清单、故障排查。
> 🔌 **要做接口对接？** 看 [API.md](API.md) — HTTP / SSE 全量契约、断线续传、错误模型、限流。
> 🛡️ **要看权限矩阵？** 看 [ROLES.md](ROLES.md) — 角色、权限、数据范围、鉴权链路。
> 💬 **要看业务命令字典？** 看 [COMMANDS.md](COMMANDS.md) — 角色推荐 chips、命令 → intent 绑定。
> 📜 **要看变更历史？** 看 [CHANGELOG.md](CHANGELOG.md) — 版本里程碑与升级注意事项。
> 🔧 **要做开发？** 继续往下读。

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    EnterpriseGateway (Phase 7)               │
│   Web · WeCom · Feishu · DingTalk · Webhook · Cron 统一接入  │
└──────────────────────────┬──────────────────────────────────┘
                           │ GatewayInbound
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              BusinessQueryEngine (Phase 1)                   │
│  resolve_user → load_session → ingest_context               │
│  → assemble_context → run_orchestrator → schedule_evolution  │
│  → track_usage                                               │
└───────────┬──────────────┬──────────────────────────────────┘
            │              │
            ▼              ▼
    ┌───────────┐   ┌──────────────┐
    │ Intent    │   │ RuntimeHooks │ (Phase 8) 12 个 hook 点
    │ Router    │   │ + Plugins    │ SubagentPlugin / TranscriptPlugin
    └─────┬─────┘   └──────────────┘
          │
    ┌─────▼──────────────────────────────────────────┐
    │           Handler 执行层                        │
    │  intent_query · knowledge_lookup · workflow     │
    │  chitchat · agentic (AgentRunner, Phase 8)      │
    └─────┬──────────────────────────────────────────┘
          │
    ┌─────▼──────────────────────────────────────────┐
    │           工具层 (Phase 4)                      │
    │  ToolCatalog (11 域) · PlanModeGuard            │
    │  task.* · cron.* · memory.* · evolution.*       │
    │  transcript.* · gateway.* · spawn_agent          │
    └─────┬──────────────────────────────────────────┘
          │
    ┌─────▼──────────────────────────────────────────┐
    │        持久化 & 演化层                           │
    │  TranscriptStore · MemoryIndex · EpisodeStore   │
    │  TaskStore · UserCronStore · EvolutionRuntime   │
    │  CompactBoundary · MicroCompact · SessionCompact│
    └────────────────────────────────────────────────┘
```

---

## 功能模块

### Phase 1 — Transcript + QueryEngine
- **BusinessQueryEngine**：统一消息入口，管理 `submitMessage` / `submitStream` 生命周期
- **TranscriptStore**：JSONL 格式会话记录，16 种事件类型（turn_start / tool_call / turn_end 等）
- **SQLiteTranscriptIndex**：FTS5 全文检索，`sessionSearch()` 返回上下文窗口

### Phase 2 — Memory Index + Retriever
- **MemoryIndex**：维护用户 workspace 下的 `MEMORY.md`，7 分类（user/feedback/project/reference/procedure/fact/episode）
- **MemoryRetriever**：top-k 关键词召回，`retrieve()` 返回相关记忆条目
- **EpisodeStore**：重要会话摘要持久化

### Phase 3 — Compaction + Token Budget
- **TokenBudget**：上下文预算管理，`BudgetConfig` 可配置各节预算
- **MicroCompact**：单轮轻量压缩（最近 N 轮保留，其余摘要）
- **SessionCompact**：全会话压缩（35 事件 → 3 轮摘要）
- **CompactBoundary**：transcript 边界事件标记，支持断点恢复
- **ContextAssembler**：集成 TokenBudget，返回 `token_budget_usage` + `compaction_needed` 信号

### Phase 4 — Tool Catalog + Plan Mode + OpenUI Lang
- **ToolCatalog**：11 域分类（memory/task/cron/transcript/evolution/gateway/agent/dealer/knowledge/workflow/system），三级权限（read/ask/deny）
- **PlanModeGuard**：计划模式守卫，`plan_only` / `strict` / `auto_confirm` 三种策略
- **OpenUI Lang Workbench**：6 个 Surface builder（card/table/timeline/form/chart/markdown），旧 A2UI v0.9 envelope 作为兼容输出

### Phase 5 — Task Tools + Cron Automation
- **TaskStore + readHighwatermark**：高水位标记，按 `taskListId` 分别追踪已处理任务
- **Task Tools**：9 个工具（task.list/get/create/update/complete/link_evidence/block/claim/release）
- **CronTemplates**：5 个预置汽车经销商场景（日报/库存巡检/工单提醒/线索清零/财务异常）
- **扩展 Cron Tools**：`cron.templates` / `cron.status` / `cron.apply_template`

### Phase 6 — Skill Governance
- **evolution.diff**：查看 skill patch 前后差异（original/override/candidate 三向对比）
- **evolution.disable**：语义明确版 rollback（禁用指定 skill）
- **memory.inspect**：精确/fuzzy 查找 memory 条目
- **memory.remove**：移除 memory key（支持审计 reason）

### Phase 7 — Enterprise Gateway
- **EnterpriseGateway**：统一入口，resolve sender → submitMessage → deliver → writeAudit
- **ChannelAdapterRegistry**：管理 6 个渠道适配器
- **WebChannelAdapter**：Web 渠道，deliverSink 可注入
- **WeComChannelAdapter**：企业微信 IM（需 `WECOM_CORP_ID` / `WECOM_AGENT_SECRET`）
- **FeishuChannelAdapter**：飞书 IM 事件订阅 v2 格式
- **DingTalkChannelAdapter**：钉钉自定义 Webhook 机器人（支持签名）
- **WebhookChannelAdapter**：通用 Webhook，自定义 payloadExtractor
- **CronChannelAdapter**：Cron 任务结果通知，`deliverCronResult()` 快捷方法

### Phase 8 — Hook Runtime + Subagent 协作
- **RuntimeHookName**：12 个 hook 点（message_received / before_route / after_route / before_tool_call / after_tool_call / agent_finish / session_end / before_prompt_build / before_evolution_judge / after_evolution_apply / subagent_spawn / subagent_finish）
- **SubagentPlugin**：监听 6 个 hook 点，实现 subagent evidence 追踪、evolution signal 注入、MemoryIndex 重建旁路

### Phase 9 — Observability（Langfuse 路线，独立解耦）
- **packages/observability-sdk**：`TraceEmitter` 抽象 + `LangfuseAdapter` / `NoopAdapter` + 内置 PII scrub（手机号/身份证/邮箱/中文车牌），开关由 `OBSERVABILITY_ENABLED` + `LANGFUSE_*` 决定，未配置时回落 Noop 零成本
- **ObservabilityPlugin**：订阅 18 个 runtime hook，按 `run_id` 维持 trace 边界，turn_start 开 trace、turn_end 关 trace；emitter 抛错只 warn 不影响业务
- **services/observability/**：自部署 Langfuse v3（PG + ClickHouse + Redis + MinIO 6 组件 docker-compose），单租户 by `business_id` tag
- **dashboards/**（可选）：Vite + React SPA + Express 反代，提供 RAG Recall Inspector 和 Evolution Loop Dashboard
- 设计文档：[docs/observability-architecture-decision.md](docs/observability-architecture-decision.md) + [docs/observability-tech-spec.md](docs/observability-tech-spec.md)
- 部署 runbook：[services/observability/docs/deploy.md](services/observability/docs/deploy.md)
- Tag 命名规范：[services/observability/docs/tag-spec.md](services/observability/docs/tag-spec.md)

---

## 快速开始

**3 步起服务**：

```bash
# 1. 装依赖（postinstall 自动建好运行时目录 + 复制 .env.example → .env）
npm install

# 2. 编辑 .env，填一项 LLM_API_KEY 就够（其余都有合理默认）
#    LLM_API_KEY=你的_minimax_或_deepseek_或_openai_key

# 3. 启动（自带 preflight 自检，dist 不存在自动编译）
npm start
# 打开 http://localhost:3000
```

附件功能可选（不配置自动降级，主流程不影响）：

```bash
docker compose -f docker-compose.attachments.yml up -d   # MinIO + 自动建 bucket
```

其他命令：

```bash
npm run start:dev    # 开发热路径（tsx 直跑 TS，改完即生效）
npm run preflight    # 仅跑启动前自检
npm run typecheck    # 类型检查
npm run config:check # 配置一致性自检
npm run chat -- sales_001 "汉EV 卖得还行但毛利好像不太行，看下原因"   # CLI 调试
```

---

## 关键环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `LLM_API_KEY` | LLM 调用凭证 | — |
| `LLM_BASE_URL` | OpenAI 兼容端点 | `https://api.minimaxi.com/v1` |
| `LLM_MODEL` | 默认模型 | `MiniMax-M2.7` |
| `LLM_DECISION_*` | 路由判别阶段独立模型 | 继承 LLM_* |
| `LLM_ANSWER_*` | 最终回答阶段独立模型 | 继承 LLM_* |
| `LLM_PROMPT_CACHE` | Prompt cache：`auto`（默认开）/ `off` | `auto` |
| `WECOM_MODE` | `real` 接企业微信 / `mock` 走本地 | `mock` |
| `WECOM_CORP_ID` | 企业微信 Corp ID（real 模式必填） | — |
| `WECOM_AGENT_SECRET` | 企业微信 Agent Secret | — |
| `WECOM_AGENT_ID` | 企业微信 AgentId | — |
| `FEISHU_APP_ID` | 飞书 App ID | — |
| `FEISHU_APP_SECRET` | 飞书 App Secret | — |
| `AGENTIC_DEBUG` | `1` 开启 agentic handler 详细日志 | — |
| `PORT` / `HOST` | HTTP 服务监听 | `3000` / `0.0.0.0` |
| `OBSERVABILITY_ENABLED` | `false` 强制关闭 Langfuse 上报（即使 keys 配齐） | `true` |
| `LANGFUSE_HOST` | Langfuse 自部署地址，例 `http://localhost:3001` | — |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Langfuse project keys | — |
| `OBS_SCRUB_ENABLED` | trace 上报前 PII 脱敏开关 | `true` |
| `OBS_SCRUB_DISABLED_RULES` | 逗号分隔关闭某些规则，例 `plate,id_card` | — |

---

## 目录结构

```text
src/
  agent/          Orchestrator（run + runStream）+ SessionStore
  agentic/        AgentRunner（子 Agent 轻量循环）
  openui-lang/    OpenUI Lang protocol facade + generic structured surfaces
  a2ui/           Legacy envelope compatibility + Basic/OpenUI render adapters
  context/        TokenBudget + MicroCompact + SessionCompact + CompactBoundary
  cron/           UserCronStore + CronExpression + CronTemplates + AgentJobRunner
  dealer/         DealerMetrics + DealerEvidence + DealerReportComposer
  evolution/      EvolutionRuntime + MemoryLearner + Governance + Tools
  eval/           所有自动化验证脚本（见"验证脚本"节）
  gateway/        EnterpriseGateway + ChannelAdapterRegistry + 6 个渠道适配器
  handlers/       IntentQueryHandler · KnowledgeLookup · Workflow · Chitchat · Agentic
  llm/            OpenAILLMClient + PromptCache + LocalLLM
  logs/           Logger
  mcp/            MCP Registry（Model Context Protocol 工具接入）
  memory/         MemoryIndex + MemoryRetriever + Tools
  rag/            LocalKnowledgeBase + DocumentLoader + DocumentSources
  router/         IntentRouter + CommandRegistry + DeterministicRuleRegistry
  runtime/        BusinessQueryEngine + ContextAssembler + WorkspaceContext
              + RuntimeHooks + SubagentPlugin
  sandbox/        TerminalRunner + CommandBlacklist（safe_compute 沙箱）
  scenarios/      LeaveRequest + Router 场景
  security/       AuthService
  tools/          ToolCatalog + ZodHelpers + 各领域工具（cron/task/memory/evolution/gateway）
  transcript/     TranscriptStore + SQLiteTranscriptIndex
  types/          共享 TypeScript 合约类型

skills/           Skill 包目录（manifest.json + SKILL.md）
  business-query/ dealer-after-sales/ dealer-analysis/
  dealer-inventory/ dealer-sales/ knowledge-qa/
  leave-records/ leave-request/

data/
  dealer-*.json          门店/库存/线索/订单/维修/财务/保修 mock 数据
  intent-codes/*.json    Intent Router 意图字典（14 个意图域）
  wecom-*.json           组织架构 mock
  users.json             账户 + RBAC
  tool-policies.json     工具权限策略

docs/
  claude-code-upgrade-plan.md     Phase 0-8 路线图（本次迭代依据）
  architecture.md                 长期架构设计
  architecture-intent-router.md  Intent Router 设计演进
  operations-runbook.md           运维手册
  a2ui-*.md                       legacy A2UI / OpenUI Lang 迁移设计文档
  knowledge/                      业务知识库（制度/手册/销售手册/安全策略）
  mockups/                        legacy A2UI / OpenUI Lang 流式 UI mockup（HTML 原型）
```

---

## HTTP 接口

```bash
# 非流式单轮对话
curl -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id":"sales_001","message":"汉EV 卖得还行但毛利好像不太行，看下原因","debug":true}'

# 流式（SSE，浏览器聊天页使用）
curl -N -X POST http://127.0.0.1:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"user_id":"store_gm_001","message":"门店本月库存压力如何？"}'

# 通过企业微信 user_id 发起（需配置 WECOM_MODE=real）
curl -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"wecom_userid":"sales_001","message":"差旅报销标准是什么？"}'
```

多轮对话：在请求 body 里带同一个 `session_id`。

---

## 验证脚本

### 核心回归（必跑）

```bash
npm run session:smoke        # Session 持久化恢复（Phase 1）
npm run evolution:smoke      # Evolution Runtime 冒烟
npm run business:runtime     # BusinessQueryEngine 全流程
npm run task:smoke           # TaskStore + 高水位机制
npm run cron:smoke           # Cron 任务调度
```

### Phase 1-8 专项 eval

```bash
npm run eval:query-engine-transcript  # QueryEngine + Transcript 生命周期
npm run eval:memory-index    # MemoryIndex rebuild + load + scanCategories  (8 tests)
npm run eval:compaction      # TokenBudget + MicroCompact + SessionCompact  (9 tests)
npm run eval:tool-catalog    # ToolCatalog 权限过滤 + PlanModeGuard         (7 tests)
npm run eval:tool-catalog-http # /api/tools/catalog HTTP 契约
npm run eval:task-tools      # task.* 工具 + readHighwatermark              (18 tests)
npm run eval:cron-automation # CronTemplates + cron.templates/status/apply  (36 tests)
npm run eval:skill-governance# evolution.diff/disable + memory.inspect/remove (36 tests)
npm run eval:gateway         # EnterpriseGateway + 5 渠道适配器 + 审计     (37 tests)
npm run eval:subagent-hooks  # SubagentPlugin + 12 个 RuntimeHook           (30 tests)
```

### Observability (Phase 9)

```bash
# 不依赖外部服务（默认 Noop）
npm run obs:sdk-smoke         # SDK 开关语义 + scrub + adapter 切换
npm run obs:plugin-smoke      # ObservabilityPlugin × hook 序列回放（28 tests）

# 需要本地起 Langfuse（services/observability 下 docker compose up -d）
npm run obs:up-check          # Langfuse Web 健康检查
LANGFUSE_HOST=... LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
  npm run obs:trace-roundtrip # 端到端 trace 上报 + Public API 查询 + tag 过滤
```

### 其他专项

```bash
npm run smoke                # 通用冒烟
npm run arch:smoke           # 架构冒烟
npm run eval:router          # Intent Router POC（100 用例）
npm run eval:dealer          # 汽车经销冒烟
npm run openui:regression    # OpenUI Lang 回归（旧 a2ui:regression 仍保留）
npm run evolution:governance # Evolution Governance
npm run store:concurrency    # Store 并发安全
npm run eval:query-engine-transcript  # Transcript 事件完整性
```

### 一键全量回归

```bash
npm run build:ts && \
  npm run session:smoke && \
  npm run evolution:smoke && \
  npm run business:runtime && \
  npm run task:smoke && \
  npm run cron:smoke && \
  npm run eval:memory-index && \
  npm run eval:compaction && \
  npm run eval:tool-catalog && \
  npm run eval:tool-catalog-http && \
  npm run eval:task-tools && \
  npm run eval:cron-automation && \
  npm run eval:skill-governance && \
  npm run eval:gateway && \
  npm run eval:subagent-hooks
```

---

## Tool 元数据规范

业务能力包装成 `ToolDefinition` 注册到 `ToolCatalog`。除基础字段外，还需声明治理元数据：

```typescript
defineTool({
  name: "dealer.query.inventory",
  description: "查询门店库存",
  metadata: {
    required_permissions: ["inventory:read"],
    risk_level: "read",           // "read" | "write"
    expose_to_agentic: true,      // 是否暴露给 agentic 路径
    plan_only: false,             // true 时仅 PlanMode 可调用
    requires_confirmation: false  // true 时调用前弹确认
  },
  inputSchema: z.object({ store_id: z.string() }),
  outputSchema: ToolResultBaseSchema,
  async execute(args, context) { ... }
});
```

`ToolCatalog` 按用户权限、当前 intent、PlanMode 状态动态决定哪些工具可见；`PlanModeGuard` 保证写操作在未确认时不执行。

---

## EnterpriseGateway 接入

### Web 渠道（开发/测试）

```typescript
import { EnterpriseGateway } from "./src/gateway/gateway.js";
import { WebChannelAdapter } from "./src/gateway/channels/web.js";

const gateway = new EnterpriseGateway({ queryEngine });
gateway.register(new WebChannelAdapter({
  deliverSink: async (outbound) => {
    console.log("[web]", outbound.text);
  }
}));

const result = await gateway.processInbound({
  channel: "web",
  message_id: "msg_001",
  sender_id: "user_001",
  text: "本月销售汇总",
  session_id: "sess_001"
});
```

### 企业微信渠道

```typescript
import { WeComChannelAdapter } from "./src/gateway/channels/wecom.js";

gateway.register(new WeComChannelAdapter({
  corpId: process.env.WECOM_CORP_ID!,
  agentSecret: process.env.WECOM_AGENT_SECRET!,
  agentId: process.env.WECOM_AGENT_ID!
}));
```

### Cron 任务结果通知

```typescript
import { CronChannelAdapter } from "./src/gateway/channels/cron.js";

const cronAdapter = new CronChannelAdapter();
gateway.register(cronAdapter);

// 在 cron job 完成后通知
await cronAdapter.deliverCronResult(cronSpec, cronEntry);
```

---

## SubagentPlugin 接入

```typescript
import { createSubagentPlugin } from "./src/runtime/subagent-plugin.js";
import { RuntimeHooks } from "./src/runtime/hooks.js";

const hooks = new RuntimeHooks();
const subagentPlugin = createSubagentPlugin({
  taskStore,
  memoryIndex,
  enableEvidenceTracking: true,  // after_tool_call 自动追踪 evidence
  enableMemoryIndexRebuild: true // after_evolution_apply 旁路重建 MEMORY.md
});

hooks.use(subagentPlugin);
```

监听的 hook 点：
- `subagent_spawn` → 父 task evidence 追加 spawn 记录
- `subagent_finish` → 父 task evidence 追加 result 记录
- `after_tool_call` → active task evidence 自动追踪
- `before_evolution_judge` → 注入 active task snapshot 作为 evolution signal
- `after_evolution_apply` → 旁路触发 `memoryIndex.rebuild()`
- `message_received` → 占位 handler，仅记录 recent 日志

---

## 性能优化说明

### MemoryIndex 增量写入
`MemoryIndex.rebuild()` 在 `changed > 0` 时才触发，且以 **fire-and-forget** 方式异步执行（`.catch(() => undefined)`），不阻塞主流程。

内置的增量更新机制（`rebuildIncremental`）：仅当 items diff（新增/修改/删除）时才重写 `MEMORY.md`，避免频繁全量 IO：
- 先读取当前 `MEMORY.md` 的 frontmatter `item_count` + `updated_at`
- 对比 items 数量和最新 `updated_at`，未变化时直接跳过
- 仅在实际变更时调用 `writeFile`

### EnterpriseGateway 并发 deliver + 审计异步化
- `deliver` 和 `writeAudit` 并发执行（`Promise.allSettled`），减少串行等待
- 审计写入失败不影响 deliver 结果（独立 try-catch）
- 审计目录 `mkdir` 只在首次调用时执行（带 `recursive: true`，幂等）

### CompactBoundary 懒判断
`CompactBoundary.shouldCompact()` 先做廉价的事件计数判断，仅超过阈值时才加载完整 transcript 进行 token 估算，避免每轮都做 IO。

---

## 接 MiniMax 之外的模型

LLM 客户端是 OpenAI 兼容接口，修改以下环境变量即可切换：

```bash
# 接 DeepSeek
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# 接 OpenAI
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o

# 路由用便宜模型，回答用贵模型
LLM_DECISION_MODEL=deepseek-chat
LLM_DECISION_BASE_URL=https://api.deepseek.com/v1
LLM_ANSWER_MODEL=gpt-4o
LLM_ANSWER_BASE_URL=https://api.openai.com/v1
```

---

## 扩展点

| 扩展点 | 说明 |
|---|---|
| `RuntimeHooks.use(plugin)` | 注册 RuntimePlugin，监听任意 hook 点 |
| `ChannelAdapterRegistry.register(adapter)` | 接入新的消息渠道 |
| `ToolCatalog.register(tool)` | 注册新工具到对应域 |
| `CRON_TEMPLATES` | 在 `src/cron/cron-templates.ts` 追加新的 Cron 模板 |
| `skills/` | 新增 Skill 包（manifest.json + SKILL.md） |
| `data/intent-codes/` | 扩展意图字典（JSON 格式，自动加载） |

---

## 已知限制

- `agentic-skills/compose-followup/` — 占位，未实现
- 腾讯文档真实接入 — Source 类已写，默认仍是 mock（`TENCENT_DOCS_MODE=mock`）
- 多租户 tenant 路由 — Gateway 层预留了 `resolveUserId` 钩子，但 tenant 隔离尚未实现
- 限流 / 去重 — Gateway 层预留 RateLimiter 插件接入点，当前未实现
- `AgentRunner` 决策函数需自行注入真实 LLM 调用（测试时可 mock）

# 对标 Claude Code 的分阶段升级计划

本文用于记录当前 Agent 项目对标 Claude Code / OpenClaw / Hermes Agent 的长期升级路线。

当前主线分支 `codex/a2ui-integration` 的边界是：**在已有 A2UI、Intent Router、ToolRegistry、RBAC、Evolution 雏形之上，开始补齐可长期演进的 Agent Runtime 基座**。升级时不要一次性复刻 OpenClaw / Hermes / Claude Code，而是优先服务企业垂类业务 Agent：可信业务执行、可审计、可恢复、可长期运行。

## 目标定位

本项目不是一次性复刻 Claude Code，而是分阶段补齐核心架构能力，并保留自己的企业垂类定位：

```text
Phase 0 当前主线：A2UI + Intent Router + 生产化基础收口
Phase 1 会话编排：Transcript + QueryEngine
Phase 2 上下文工程：Memory Index + Retriever + Episodes
Phase 3 上下文预算：Compaction + Token Budget
Phase 4 企业能力目录：Tool Catalog + Plan Mode / 权限分层
Phase 5 长程任务：Task Tools + Cron / Automation 产品化
Phase 6 自进化：Skill Patch Subagent + Governance
Phase 7 企业入口：Gateway + WeCom / Feishu / Webhook
Phase 8 多 Agent：Subagent 协作 + Workspace 隔离增强
```

## 对标项目后的 7 个升级目标

这 7 个目标来自当前项目与 OpenClaw、Hermes Agent、Claude Code 的对比。它们不是并列开工项，而是按依赖关系分层推进。

### 1. QueryEngine + Transcript

优先级：P0，第一阶段立即启动。

目标：补齐 Claude Code 式会话编排层，让每轮对话从"请求进来直接跑 orchestrator"升级为"QueryEngine 接管生命周期"。

要做：

```text
submitMessage()
appendTranscript()
loadSession()
buildContext()
runOrchestratorTurn()
scheduleEvolution()
trackUsage()
```

收益：

```text
完整审计每轮 route/tool/answer/evolution
支持恢复、重放、调试和后续 compaction
让 orchestrator 变薄，生命周期逻辑集中
```

### 2. Memory 从写入升级为召回

优先级：P0，依赖 Transcript 的事件来源。

目标：学习 Hermes 的长期记忆和 Claude Code 的 context memory，但保持企业业务语义。Memory 不能只在会后写入，还要能在下一轮按相关性召回。

要做：

```text
MEMORY.md 索引
user / feedback / project / reference / episode 分类
memory retriever top-k 召回
active task + route + current message 联合检索
```

收益：

```text
不再全量注入 memory
用户偏好、业务上下文、历史决策能跨会话生效
减少上下文污染和 token 浪费
```

### 3. 企业版 Gateway

优先级：P2，等 QueryEngine 和鉴权边界稳定后启动。

目标：参考 OpenClaw 的 Gateway 思想，但不追求全渠道个人助理。当前项目优先做企业入口：WebChat、企业微信、飞书、钉钉、HTTP webhook、定时任务。

要做：

```text
Gateway 统一接入 channel / sender / session / workspace
Channel adapter: web, wecom, feishu, webhook, cron
入口统一走 QueryEngine
按 channel 做权限、身份映射和审计
```

收益：

```text
从单 Web 页面升级为企业 Agent 入口层
不同渠道共享 session、memory、task 和权限体系
为 always-on 经营助手打底
```

### 4. 工具系统升级为能力目录

优先级：P1，QueryEngine 后即可并行。

目标：让用户和系统都能清楚知道"当前有哪些能力、谁能用、风险等级是什么、底层工具是什么"。这是企业 Agent 与通用 Agent 的关键差异。

要做：

```text
/api/tools/catalog
runtime inspection surface
按业务域分类：经营分析 / 风险监控 / 线索 / 库存 / 售后 / 财务 / 知识库 / 沙箱 / 任务
展示 tool metadata: permissions, risk_level, requires_confirmation, expose_to_agentic, schema summary
```

收益：

```text
用户问"底层有哪些工具"时能给出准确答案
前端能做能力面板
Plan Mode 和权限分层有统一数据源
```

### 5. Plan Mode / Ask-Approve-Deny 权限层

优先级：P1，依赖 Tool Catalog 的风险元数据。

目标：参考 Claude Code 的权限边界：读操作自动执行，中风险操作要求确认，高风险操作拒绝或管理员配置。

要做：

```text
read: 自动执行
ask: 生成 plan + pending action，等待确认
deny: 直接拒绝并说明原因
Plan Mode: 只允许 route / inspect / read，不允许 write / external side effect
```

收益：

```text
企业场景下可放心开放更多工具
写操作、发消息、调度任务、外部 webhook 不会被模型直接执行
A2UI pending action 能成为统一确认入口
```

### 6. 长任务和定时任务产品化

优先级：P2，依赖 QueryEngine、Task Tools 和权限确认。

目标：参考 Hermes / OpenClaw 的 cron 和 automation，把已有 cron/task 模块做成汽车经销业务场景的 always-on 经营助手。

优先场景：

```text
每日经营日报
库存风险巡检
超期工单提醒
保修索赔材料缺失提醒
线索清零检查
财务异常波动摘要
```

收益：

```text
Agent 从被动问答变成主动经营监控
沉淀可复用 task / report / reminder
形成业务价值闭环
```

### 7. A2UI 经营工作台

优先级：P1，和 Tool Catalog / Plan Mode 并行。

目标：把 A2UI 从"消息里的结构化渲染"升级成"企业经营工作台"。参考 OpenClaw Live Canvas，但聚焦业务表格、风险列表、指标卡、行动确认和证据链。

要做：

```text
指标卡：经营指标、风险指标、同比环比
风险列表：库存、工单、索赔、线索、财务
行动确认：pending action / plan approve
证据展开：tool result / query filters / source refs
任务追踪：active tasks / cron reports / reminders
```

收益：

```text
复杂业务回答不只靠文本承载
用户能检查数据来源和执行动作
形成企业 Agent 的可操作 UI 面
```

## 优先级和启动顺序

当前建议按下面顺序开工。P0 是立即做，P1 是 QueryEngine 落地后并行推进，P2 是基础稳定后产品化。

| 优先级 | 目标 | 推荐分支 | 启动条件 | 完成信号 |
|---|---|---|---|---|
| P0 | QueryEngine + Transcript | `codex/add-query-engine-transcript` | 当前 A2UI stream 稳定 | 每轮完整 JSONL transcript，可恢复最近会话 |
| P0 | Memory Retriever | `codex/add-memory-retriever` | Transcript 能提供窗口 | memory top-k 召回，不再全量注入 |
| P1 | Tool Catalog | `codex/add-tool-catalog` | ToolRegistry metadata 稳定 | `/api/tools/catalog` + A2UI 能力面板 |
| P1 | Plan Mode / 权限分层 | `codex/add-plan-permissions` | Tool Catalog 有风险元数据 | read/ask/deny 生效，pending action 统一确认 |
| P1 | A2UI 经营工作台 | `codex/add-a2ui-business-workbench` | A2UI envelope/action 稳定 | 指标卡、风险列表、行动确认、证据展开 |
| P2 | Task + Cron 产品化 | `codex/productize-task-cron` | Plan Mode 和 Task Tools 可用 | 日报、巡检、提醒能 unattended 运行 |
| P2 | Enterprise Gateway | `codex/add-enterprise-gateway` | QueryEngine 接入稳定 | Web/WeCom/Webhook/Cron 统一 session 入口 |

第一轮升级只做 P0：

```text
1. 新增 TranscriptStore
2. 新增 QueryEngine
3. HTTP / CLI / A2UI stream 入口逐步改为 QueryEngine.submitMessage()
4. transcript 写入 route_decision / tool_call / tool_result / assistant_message
5. evolution 改读 transcript window
6. 加 session recovery eval
```

## Claude Code 对标差距总览

| 能力 | Claude Code | 当前项目 | 差距 |
|---|---|---|---|
| 用户工作空间 | 项目级本地目录 | 已有 `users/{userId}/workspace` | 基础可用 |
| Session | QueryEngine 管理多轮状态 | `UserWorkspaceSessionStore` | 缺 QueryEngine |
| Transcript | JSONL 全量事件持久化 | 暂无 | 缺口大 |
| Memory | `MEMORY.md` 索引 + 多文件记忆 + 召回 | `memory.json` + evolution 写入 | 中等缺口 |
| Task | TodoWrite / Tasks V2 双轨 | 已有结构化 TaskStore | 缺 task tools / claim |
| Context | 动态 system prompt + memory + tools + token budget | enterpriseContext 注入 | 缺预算和检索 |
| Compaction | Micro / Session Memory / API summary 三层 | 暂无 | 缺口大 |
| Tools | 完整 Tool 接口 + 权限 + MCP | 已有 ToolRegistry | 可继续增强 |
| Evolution | 没有完全等价模块 | 已有 LLM Judge + evolution runtime | 方向可行 |
| Subagent | fork / async / permissions | 只用于人工流程 | 未产品化 |

## Phase 0：Memory + 主动沉淀（已有基座）

目标：把当前已有的用户 workspace、Memory、Task、Evolution 能力收敛成一个干净、可验证的主动沉淀底座。

当前基座范围内的目录：

```text
users/{userId}/workspace/
  memory/
    memory.json
  tasks/
    active.json
    lists/{taskListId}/{taskId}.json
  .evolution/
    evolution-log.jsonl
    preferences.md
    skills/{skillId}/evolution_preferences.md
```

必须完成：

1. 用户 workspace 隔离
   所有用户私有状态只能写入 `users/{userId}/workspace`。

2. 记忆写入只走 LLM Judge
   不允许规则 fallback 写 memory。

3. 主动沉淀
   `finish -> EvolutionRuntime -> LLM Judge -> MemoryLearner / TaskLearner / SkillLearner`。

4. Task 从 memory 中剥离
   Task 是结构化状态，不是 memory。

5. Evolution 产物运行时生效
   - `preferences.md` 注入 context
   - `evolution_preferences.md` 注入 skill
   - `.evolution/skills/{skillId}/SKILL.md` 可覆盖 agentic skill

6. 验证脚本稳定
   - `npm run typecheck`
   - `npm run workspace:isolation`
   - `npm run task:smoke`
   - `npm run evolution:smoke`
   - `npm run session:smoke`

Phase 0 不继续扩张：

```text
Transcript
QueryEngine
Memory Retriever
Compaction
Task Tools
Patch Subagent
Rollback UI/API
多 Agent 协作
```

Phase 0 完成标准：

```text
能稳定写入个人记忆
能稳定写入结构化 task
能记录 evolution log
能让 evolution preference 在下一轮生效
不会跨用户串线
无规则 fallback 写记忆
```

## Phase 1：Transcript + QueryEngine

目标：补 Claude Code 式多轮会话编排层。

新增模块：

```text
src/runtime/query-engine.ts
src/runtime/transcript-store.ts
```

新增目录：

```text
users/{userId}/workspace/transcripts/{sessionId}.jsonl
```

Transcript 事件类型：

```text
user_message
assistant_message
route_decision
tool_call
tool_result
permission_denial
agent_step
evolution_result
compact_boundary
```

QueryEngine 职责：

```text
submitMessage()
appendTranscript()
loadSession()
buildContext()
runOrchestratorTurn()
scheduleEvolution()
trackUsage()
```

完成标准：

```text
每轮对话完整落 JSONL
可从 transcript 恢复最近会话
evolution 可读取一段 transcript window
orchestrator 中会话生命周期逻辑明显变薄
```

## Phase 2：Memory Index + Retriever + Episodes

目标：从全量 memory 注入升级为相关 memory 召回。

新增结构：

```text
memory/
  MEMORY.md
  user/
  feedback/
  project/
  reference/
  episodes.jsonl
```

记忆类型：

```text
user       用户偏好、角色、稳定背景
feedback   用户对 agent 行为的正/负反馈
project    非代码可推导的业务上下文
reference  外部系统/指标/文档指针
episode    重要会话事件摘要
```

新增模块：

```text
src/memory/memory-index.ts
src/memory/memory-retriever.ts
src/memory/episode-store.ts
```

召回方式：

```text
当前消息 + route + active tasks
  -> 扫 MEMORY.md/frontmatter
  -> LLM side query 选 top-k
  -> 注入相关 memory
```

完成标准：

```text
不再每次注入全部 memory
有 MEMORY.md 索引
记忆能按相关性 top-k 召回
episodes 能追加和参与后续压缩
```

## Phase 3：Compaction + Token Budget

目标：避免长期运行后上下文失控。

新增模块：

```text
src/context/token-budget.ts
src/context/micro-compact.ts
src/context/session-compact.ts
src/context/compact-boundary.ts
```

三层压缩：

```text
MicroCompact:
  清理旧 tool result 大字段，只保留摘要/ref

SessionCompact:
  transcript window -> session summary

MemoryCompact:
  memory/episodes/tasks 超限后合并、去重、压缩
```

完成标准：

```text
大 tool result 不再无限进入 prompt
长 session 能自动摘要
压缩边界写入 transcript
压缩后仍保留 active tasks、相关 memory、最近 user intent
```

## Phase 4：Tool Catalog + Plan Mode + A2UI Workbench

目标：把工具、权限和 A2UI 统一成企业业务能力面板，让用户、前端和 Agent 都能知道"有哪些能力、谁能用、风险是什么、是否需要确认"。

新增接口：

```text
GET /api/tools/catalog
GET /api/tools/catalog?user_id=
GET /api/tools/catalog?domain=dealer.risk
```

能力分类：

```text
经营分析
风险监控
客户线索
库存订单
售后工单
财务与毛利
知识库
安全沙箱
任务与调度
系统维护
```

权限分层：

```text
allow/read:
  低风险读取，自动执行

ask/confirm:
  中风险操作，生成 plan + pending action，等待用户确认

deny:
  高风险或无权限操作，直接拒绝并说明原因

plan_only:
  Plan Mode 下只允许 route / inspect / read，不允许 write / external side effect
```

A2UI 工作台组件：

```text
ToolCatalogSurface       当前可用能力
RiskListSurface          库存 / 工单 / 索赔 / 线索 / 财务风险
MetricCardsSurface       关键经营指标
EvidenceSurface          tool result / query filters / source refs
PendingActionSurface     需要确认的执行动作
TaskTrackingSurface      active tasks / cron reports / reminders
```

完成标准：

```text
用户能问"当前有哪些工具/能力"，回答来自真实 ToolRegistry
前端能展示按权限过滤后的能力目录
中高风险工具不会绕过确认执行
非 debug 模式下仍能展示业务有用的证据和行动卡片
```

## Phase 5：Task Tools + Cron / Automation 产品化

目标：让 agent 主动维护任务，并把 cron / automation 做成企业经营场景，而不是只靠 evolution 会后写。

新增工具：

```text
task.list
task.get
task.create
task.update
task.complete
task.link_evidence
task.block
task.claim
task.release
```

增强 TaskStore：

```text
tasks/lists/{taskListId}/.highwatermark
tasks/lists/{taskListId}/.lock
```

能力：

```text
任务依赖 blocks / blocked_by 双向维护
owner 认领
agent_busy 检查
completed 后 active index 自动移除
```

完成标准：

```text
agent 能在长程任务中显式创建/更新/完成 task
支持 blocked / dependency
支持基础并发安全
每日经营日报 / 库存风险巡检 / 超期工单提醒等场景能 unattended 运行
```

## Phase 6：Skill Patch Subagent + Governance

目标：让自进化真正修改 skill，并且可审计、可回滚。

新增模块：

```text
src/evolution/skill-patch-runner.ts
src/evolution/evolution-governance.ts
```

新增工具：

```text
evolution.inspect
evolution.diff
evolution.rollback
evolution.disable
memory.remove
memory.inspect
```

Patch 流程：

```text
Judge 输出 skill patch action
  -> fork Patch Subagent
  -> 读取原 skill + latest evolution skill
  -> 修改 SKILL.md/template/scripts
  -> 写入 .evolution/skills/{skillId}
  -> 写 patch-meta.json
```

完成标准：

```text
能自动生成 evolution skill patch
能查看 patch 来源和 diff
能回滚某个 skill evolution
错误进化不会永久污染用户 workspace
```

## Phase 7：Enterprise Gateway

目标：参考 OpenClaw Gateway 思想，将 Web、企业微信、飞书、钉钉、Webhook、Cron 统一成企业入口层，但不追求个人助理的全渠道覆盖。

新增模块：

```text
src/gateway/gateway.ts
src/gateway/channel-adapter.ts
src/gateway/channels/web.ts
src/gateway/channels/wecom.ts
src/gateway/channels/feishu.ts
src/gateway/channels/webhook.ts
src/gateway/channels/cron.ts
```

Gateway 职责：

```text
resolve sender -> user_id / tenant / channel
resolve session -> workspace session
normalize inbound message
call QueryEngine.submitMessage()
deliver response / A2UI summary / notification
write channel audit event
```

完成标准：

```text
Web / WeCom / Webhook / Cron 入口共享 QueryEngine
不同 channel 不再各自拼 session 和权限
企业渠道身份映射、审计、限流统一
```

## Phase 8：Hooks / Extension Runtime + Subagent 协作

目标：把 evolution、memory、task、transcript 变成生命周期钩子，而不是散落在 orchestrator 里。

Hook 点：

```text
message_received
before_route
after_route
before_tool_call
after_tool_call
agent_finish
session_end
before_prompt_build
before_evolution_judge
after_evolution_apply
```

完成标准：

```text
核心 orchestrator 只负责主流程
memory/evolution/task 通过 hooks 接入
后续能力能插件化扩展
Subagent 可在明确权限和 workspace 隔离下执行并行任务
```

## 当前主线收敛建议

当前 `codex/a2ui-integration` 不要继续无限扩张。建议只补齐这些收尾项，然后新开 P0 分支进入 QueryEngine：

1. 确认 A2UI stream、history、action、debug gating 稳定。
2. 确认 `users/` 测试产物不进入 git。
3. 确认 auth disabled 只用于本地开发，生产必须走 token。
4. 保持 `npm run build:ts`、A2UI eval、router/dealer eval 稳定。
5. 将本文档作为后续拆分分支的总计划引用。

当前主线：

```text
codex/a2ui-integration
```

后续分支建议：

```text
codex/add-query-engine-transcript
codex/add-memory-retriever
codex/add-context-compaction
codex/add-tool-catalog
codex/add-plan-permissions
codex/add-a2ui-business-workbench
codex/productize-task-cron
codex/add-evolution-patch-governance
codex/add-enterprise-gateway
codex/add-runtime-hooks-subagents
```

## 一句话路线图

```text
当前主线：先把 A2UI + Intent Router + 生产化基础收稳
下一分支：补 Transcript 和 QueryEngine，让每轮会话可审计、可恢复、可重放
再下一分支：做 Memory Retriever 和 Compaction
之后：做 Tool Catalog、Plan Mode、A2UI 经营工作台
再之后：产品化 Task / Cron、Patch Subagent、Enterprise Gateway
最后：抽 Hook Runtime 和 Subagent 协作，走向企业版完整 agentic system
```

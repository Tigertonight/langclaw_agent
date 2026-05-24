# 企业 Agent Runtime 升级计划

本文记录当前汽车经销企业 Agent 对标 Claude Code / OpenClaw / Hermes Agent 后的长期升级路线。文档不以"复刻某个项目"为目标，而是把三个参考项目中适合企业业务 Agent 的能力沉淀成可执行 roadmap。

当前主线分支 `codex/a2ui-integration` 已完成一次大升级：在 A2UI、Intent Router、ToolRegistry、RBAC、Evolution 基座之上，补齐了 QueryEngine、Transcript、Memory Retriever、Compaction、Tool Catalog、Plan Mode、A2UI Workbench、Task/Cron、Gateway、Skill Governance 和 Subagent Hooks。

最新完成提交：

```text
99cdab5 Complete agent runtime upgrade
```

当前验证基线：

```text
npm run build:ts
npm run typecheck
npm run smoke
npm run eval:dealer
npm run eval:router          # 100/100
npm run a2ui:adapter
npm run a2ui:regression
npm run eval:query-engine-transcript
npm run eval:memory-index
npm run eval:compaction
npm run eval:tool-catalog
npm run eval:tool-catalog-http
npm run eval:task-tools
npm run eval:cron-automation
npm run eval:gateway
npm run eval:skill-governance
npm run eval:subagent-hooks
```

## 目标定位

本项目的长期定位是：**企业垂类经营 Agent**。

底层学习 Claude Code 的 QueryEngine、工具权限、上下文预算和可恢复执行；中层学习 Hermes Agent 的记忆、技能演化、Cron 和 Subagent；入口层学习 OpenClaw 的 Gateway、多渠道和工作台体验。最终产品形态不是个人助理，也不是 coding agent，而是一个可审计、可确认、可长期运行的企业经营工作台。

当前 Phase 状态：

```text
Phase 0 已完成：A2UI + Intent Router + 生产化基础
Phase 1 已完成：Transcript + QueryEngine
Phase 2 已完成：Memory Index + Retriever + Episodes
Phase 3 已完成：Compaction + Token Budget
Phase 4 已完成：Tool Catalog + Plan Mode + A2UI Workbench
Phase 5 已完成：Task Tools + Cron / Automation
Phase 6 已完成：Skill Patch Subagent + Governance
Phase 7 已完成：Enterprise Gateway + Web / WeCom / Feishu / DingTalk / Webhook / Cron
Phase 8 已完成：Runtime Hooks + Subagent 协作基座
```

下一轮重点不再是"补模块"，而是把已完成模块产品化、生产化和体验化。

## 对标项目后的 7 个升级目标

这 7 个目标来自当前项目与 OpenClaw、Hermes Agent、Claude Code 的对比。第一轮 runtime upgrade 已经完成这些能力的代码基座；下一轮优化要把它们从"框架可用"推进到"企业生产可用"。

### 1. QueryEngine + Transcript

状态：已完成基座。

目标：补齐 Claude Code 式会话编排层，让每轮对话从"请求进来直接跑 orchestrator"升级为"QueryEngine 接管生命周期"。

已完成：

```text
BusinessQueryEngine.submitMessage()
BusinessQueryEngine.submitStream()
TranscriptStore JSONL + SQLite FTS
transcript.replay / transcript.search tools
query-engine-transcript eval
```

下一步优化：

```text
给 transcript 增加可视化审计面板
补 tool_call / tool_result 的脱敏摘要策略
将 QueryEngine 作为所有 channel 的唯一入口，清理旁路调用
```

### 2. Memory 从写入升级为召回

状态：已完成基座。

目标：学习 Hermes 的长期记忆和 Claude Code 的 context memory，但保持企业业务语义。Memory 不能只在会后写入，还要能在下一轮按相关性召回。

已完成：

```text
MEMORY.md 索引
user / feedback / project / reference / episode 分类
memory retriever top-k 召回
active task + route + current message 联合检索
```

下一步优化：

```text
用户可查看 / 删除 / 修正记忆
记忆写入增加置信度和来源证据
引入 embedding 或混合检索，替换纯关键词 top-k
建立记忆冲突解决 UI
```

### 3. 企业版 Gateway

状态：已完成基座。

目标：参考 OpenClaw 的 Gateway 思想，但不追求全渠道个人助理。当前项目优先做企业入口：WebChat、企业微信、飞书、钉钉、HTTP webhook、定时任务。

已完成：

```text
Gateway 统一接入 channel / sender / session / workspace
Channel adapter: web, wecom, feishu, dingtalk, webhook, cron
入口统一走 QueryEngine
按 channel 做权限、身份映射和审计
```

下一步优化：

```text
真实渠道验签：WeCom / Feishu / DingTalk
消息去重、重试、死信 outbox
tenant / channel 级限流
Gateway 状态页和 channel doctor
```

### 4. 工具系统升级为能力目录

状态：已完成基座。

目标：让用户和系统都能清楚知道"当前有哪些能力、谁能用、风险等级是什么、底层工具是什么"。这是企业 Agent 与通用 Agent 的关键差异。

已完成：

```text
/api/tools/catalog
runtime inspection surface
按业务域分类：经营分析 / 风险监控 / 线索 / 库存 / 售后 / 财务 / 知识库 / 沙箱 / 任务
展示 tool metadata: permissions, risk_level, requires_confirmation, expose_to_agentic, schema summary
```

下一步优化：

```text
把 Tool Catalog 接入聊天页能力面板
给每个工具补业务口径、数据源和示例问法
记录最近调用次数、失败率、平均耗时
将 catalog 作为模型 tool selection 的显式上下文
```

### 5. Plan Mode / Ask-Approve-Deny 权限层

状态：已完成基座。

目标：参考 Claude Code 的权限边界：读操作自动执行，中风险操作要求确认，高风险操作拒绝或管理员配置。

已完成：

```text
read: 自动执行
ask: 生成 plan + pending action，等待确认
deny: 直接拒绝并说明原因
Plan Mode: 只允许 route / inspect / read，不允许 write / external side effect
```

下一步优化：

```text
将所有 write / external side effect 工具强制接入 pending action
补管理员级策略配置文件和热加载
增加审批超时、撤销、二次确认
在 A2UI 中展示 plan diff 和影响范围
```

### 6. 长任务和定时任务产品化

状态：已完成基座。

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

下一步优化：

```text
给每个模板补交付样例和 A2UI 报告面板
Cron 运行失败自动暂停 + 用户可恢复
支持日报订阅人、发送渠道、静默时间窗口
将 cron 结果写入 task evidence 和 transcript
```

### 7. A2UI 经营工作台

状态：已完成基座。

目标：把 A2UI 从"消息里的结构化渲染"升级成"企业经营工作台"。参考 OpenClaw Live Canvas，但聚焦业务表格、风险列表、指标卡、行动确认和证据链。

已完成：

```text
指标卡：经营指标、风险指标、同比环比
风险列表：库存、工单、索赔、线索、财务
行动确认：pending action / plan approve
证据展开：tool result / query filters / source refs
任务追踪：active tasks / cron reports / reminders
```

下一步优化：

```text
统一 Workbench 视觉规范和组件密度
把 ToolCatalogSurface / RiskListSurface 接入真实聊天回答
补移动端布局和长表格滚动体验
支持证据节点点击后展开原始 query / tool result
```

## 下一轮优化优先级

第一轮 runtime upgrade 已经完成 Phase 1-8 的代码基座。下一轮不再按 Phase 开大分支，而是按生产价值和风险收敛拆成 6 条优化线。

| 优先级 | 优化线 | 推荐分支 | 为什么现在做 | 完成信号 |
|---|---|---|---|---|
| P0 | Gateway 生产化 | `codex/harden-enterprise-gateway` | 多渠道入口是企业部署第一道边界 | WeCom/Feishu/DingTalk 验签、去重、重试、channel audit、doctor eval |
| P0 | Plan Mode 接管写操作 | `codex/enforce-plan-mode-actions` | 工具越来越多，必须先守住副作用边界 | 所有 write/external 工具都走 pending action；无确认无法执行 |
| P1 | A2UI Workbench 接真实业务回答 | `codex/connect-a2ui-workbench` | 目前 Workbench builder 已有，价值要在聊天页露出 | 风险列表、指标卡、证据展开、任务追踪能由真实 tool result 驱动 |
| P1 | Memory UX + Governance | `codex/productize-memory-governance` | 记忆已能召回，但用户还不能管理 | 记忆查看、删除、修正、来源证据、冲突处理可用 |
| P1 | Cron 经营自动化 | `codex/productize-dealer-automation` | 最能体现业务价值，从问答变成经营雷达 | 日报/库存巡检/工单提醒/线索清零/财务异常模板可配置、可投递、可恢复 |
| P2 | Eval Dashboard + Observability | `codex/add-runtime-observability` | eval 已多，缺统一看板和质量趋势 | eval 汇总、router 成功率、tool 失败率、latency、trace link 可查看 |

下一轮建议先做 P0，两条线可以并行但不能互相绕开：

```text
1. Gateway 生产化负责入口可信：验签、身份、去重、审计、限流。
2. Plan Mode 接管写操作负责执行可信：副作用工具必须确认。
3. 两条线共同复用 QueryEngine / Transcript / ToolCatalog。
4. 所有新增能力必须补 eval，并写入 README 验证脚本。
```

## 对标差距总览

| 能力 | Claude Code / OpenClaw / Hermes 参考 | 当前项目状态 | 下一步差距 |
|---|---|---|---|
| 用户工作空间 | Claude Code 项目目录 / Hermes 本地状态 | 已有 `users/{userId}/workspace` | tenant 隔离、配额、备份恢复 |
| Session | QueryEngine 管理多轮状态 | 已有 `BusinessQueryEngine` | 所有入口强制统一走 QueryEngine |
| Transcript | JSONL 全量事件持久化 + 搜索 | 已有 `TranscriptStore` + SQLite FTS | 可视化审计、脱敏、导出 |
| Memory | `MEMORY.md` 索引 + 召回 + 用户可控 | 已有 `MemoryIndex` + `MemoryRetriever` | 用户管理 UI、冲突治理、混合检索 |
| Task | TodoWrite / Tasks V2 / automation | 已有 TaskStore + task tools + evidence | 任务看板、依赖图、多人协作 |
| Context | 动态 prompt + token budget + compaction | 已有 `ContextAssembler` + compaction | 更精细的 token 估算和质量回归 |
| Tools | 权限、schema、MCP、Plan Mode | 已有 ToolCatalog + PlanModeGuard | 全量副作用工具确认、工具质量指标 |
| A2UI / Canvas | OpenClaw Live Canvas | 已有 A2UI Workbench builders | 接入真实回答、移动端体验、证据交互 |
| Gateway | OpenClaw local-first gateway | 已有 EnterpriseGateway + 6 adapters | 真实验签、去重、重试、渠道 doctor |
| Evolution | Hermes 学习闭环 | 已有 Skill Governance + Patch Runner | 用户可控 skill 演化、回滚 UI |
| Subagent | fork / async / permissions | 已有 AgentRunner + SubagentPlugin | 子 agent 权限、并行任务 UI、资源配额 |

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

已完成模块：

```text
src/runtime/business-query-engine.ts
src/transcript/transcript-store.ts
src/transcript/sqlite-transcript-index.ts
```

新增目录：

```text
users/{userId}/workspace/transcripts/{sessionId}.jsonl
```

Transcript 事件类型：

```text
turn_start
user_message
assistant_message
route_decision
tool_call
tool_result
permission_denial
agent_step
evolution_result
compact_boundary
turn_end
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

已完成模块：

```text
src/memory/memory-index.ts
src/memory/memory-retriever.ts
src/evolution/memory-compactor.ts
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

已完成模块：

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

已完成模块：

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
src/gateway/channels/dingtalk.ts
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
Web / WeCom / Feishu / DingTalk / Webhook / Cron 入口共享 QueryEngine
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
subagent_spawn
subagent_finish
```

完成标准：

```text
核心 orchestrator 只负责主流程
memory/evolution/task 通过 hooks 接入
后续能力能插件化扩展
Subagent 可在明确权限和 workspace 隔离下执行并行任务
```

## 当前主线收敛建议

当前 `codex/a2ui-integration` 已完成 runtime upgrade。后续不要继续把所有优化堆在主线分支里，建议以 P0/P1 优化线拆分小分支推进。

主线进入下一阶段前必须保持：

1. `npm run build:ts`、`npm run typecheck` 稳定。
2. `npm run eval:router` 保持 100/100，超时类用例必须可重试。
3. A2UI 非 debug 模式不泄露 runtime summary。
4. `/api/tools/catalog`、Gateway、PlanMode 相关 eval 必须纳入回归。
5. `users/`、`dist/`、真实 token、渠道 webhook secret 不进入 git。
6. 本地开发可用 `A2UI_AUTH_DISABLED=1`，生产必须走 bearer token。

当前主线：

```text
codex/a2ui-integration
```

下一轮分支建议：

```text
codex/harden-enterprise-gateway
codex/enforce-plan-mode-actions
codex/connect-a2ui-workbench
codex/productize-memory-governance
codex/productize-dealer-automation
codex/add-runtime-observability
```

## 一句话路线图

```text
已完成：企业 Agent Runtime 基座，覆盖 QueryEngine、Memory、Compaction、ToolCatalog、PlanMode、A2UI、Cron、Gateway、Governance、Subagent。
下一步：先守住入口可信和执行可信，即 Gateway 生产化 + Plan Mode 强制接管副作用工具。
再下一步：把 A2UI Workbench、Memory Governance、Cron Automation 产品化，让能力真正进入业务日常。
长期：补 Observability、Eval Dashboard、Tenant 隔离、渠道运营面板，走向企业版完整 agentic system。
```

## 下一步执行清单

建议下一轮从 `codex/harden-enterprise-gateway` 开始，完成后再接 `codex/enforce-plan-mode-actions`。

`codex/harden-enterprise-gateway` 范围：

```text
1. WeCom / Feishu / DingTalk webhook 验签。
2. message_id 去重，重复消息不重复触发 QueryEngine。
3. deliver retry + outbox dead letter。
4. channel audit 查询接口。
5. gateway doctor eval：缺凭证、签名错误、重复消息、投递失败、审计失败。
6. README 增加真实渠道接入说明。
```

`codex/enforce-plan-mode-actions` 范围：

```text
1. 梳理所有 write / external side effect 工具。
2. 强制 requires_confirmation 或 plan_only。
3. pending action 统一携带 impact summary。
4. A2UI PendingActionSurface 展示 plan diff。
5. eval 覆盖：未确认不能执行，确认后执行一次，重复确认幂等。
```

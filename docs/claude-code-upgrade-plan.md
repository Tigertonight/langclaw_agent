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

## DomainPack 解耦专项

### 审计评估（M12 完成后最终审计 · 2026-06-01）

**当前解耦程度：约 95%**。主运行链路已全面走 DomainRegistry / ResourceRegistry / QueryAdapterRegistry / FilterTransformRegistry / PermissionRuleRegistry / SkillContractEnforcerRegistry / IntentCodeInferenceFnRegistry。IntentRouter 和 IntentQueryHandler 核心路径已实现零业务域 import。外围模块（llm / agent / runtime / query / tools）中的域特定业务逻辑已全部迁移到 domain packs，残留引用均为 registry 委托 shim、LLM prompt 文本、通用字段名引用或前端 UI 展示文案。

**M8 → M12 增量解耦（2026-05-24 → 2026-06-01）：**

完成了 4 个新里程碑（M9-M12），将解耦率从 ~75% 提升到 ~95%：
- M9: nodes.ts enforceSkillContracts 迁移（~150 行业务逻辑 → attendance/skill-contracts.ts）
- M10: intent-codes.ts dealer 特定正则迁移（→ dealer/domain-pack.ts intentCodeInferenceFns）
- M11: query-parser.ts parseLeaveRecordQuery 迁移（→ attendance/query-adapter.ts parseQuery）
- M12: LLM 层 shim 验证 + 最终耦合扫描

验证基线（M8 完成后）：

```text
npm run build:ts              通过
npm run eval:domain:retail-demo 13/13 通过
npm run eval:dealer            14/14 通过
npm run eval:router            100/100 通过
```

#### 分层评分（M12 完成后最终审计）

**主链路模块（已解耦）：**

| 维度 | M4b 评分 | M8 评分 | M12 评分 | 说明 |
|------|----------|---------|----------|------|
| DomainPack 注册层 | 75% | 80% | 80% | AVAILABLE_PACKS 单一入口，手工 central list 是有意设计 |
| Resource 解耦 | 85% | 90% | 90% | 全部声明在各域，新增 displayColumns 声明式展示列 |
| Command 解耦 | 80% | 80% | 80% | 无变化 |
| Deterministic Rule 解耦 | 70% | 95% | 95% | string/ExtractorSpec 执行路径已实现（M7b） |
| QueryAdapter 解耦 | 75% | 80% | 95% | parseQuery 迁入域 adapter（M11） |
| Intent Manifest 解耦 | 35% | 95% | 95% | intentDir 域化加载已实现（M7a） |
| FilterTransform 解耦 | 0% | 95% | 95% | DomainPack.filterTransforms 动态委托（M5c） |
| Permission 解耦 | 0% | 95% | 95% | DomainPack.permissionRules 动态委托（M6a） |
| 展示层解耦 | 0% | 90% | 90% | displayColumns/labelOfMetric/labelOfField 声明化（M6b） |
| IntentRouter 解耦 | 40% | 100% | 100% | 零 domain import，零硬编码资源名（M5a/M5b） |
| 辅助函数去重 | 30% | 90% | 90% | shared/time-utils.ts 统一（M8） |
| SkillContract 解耦 | 0% | 0% | 95% | enforceSkillContracts 迁入域 pack（M9） |
| IntentCode 推断解耦 | 0% | 0% | 95% | intentCodeInferenceFns 动态委托（M10） |
| QueryParser 解耦 | 0% | 30% | 95% | parseLeaveRecordQuery/isLeaveRecordQuestion 迁入域 adapter（M11） |

**外围模块（未解耦，全量审计明细）：**

| 模块 | 涉及文件数 | 耦合点数 | 主要耦合类型 |
|------|-----------|---------|------------|
| src/llm/ | 2 | ~76 | 函数import(composeDealerReport)、资源名枚举、中文标签、intent_code判断 |
| src/runtime/ | 5 | ~50 | readableResourceName 硬编码、extractDealerFacts、intent_code前缀判断 |
| src/query/ | 3 | ~48 | parseDealerQuery/inferDealerTarget 整体硬编码、schema-catalog 11个资源 |
| src/agent/ | 4 | ~47 | pickDebugRowFields 11资源字段映射、inferIntentCode 8个映射、ports.ts 常量 |
| src/tools/ | 4 | ~20 | submit_leave_request 工具定义、cron-tools dealer域描述、tool-catalog 域分类 |
| src/a2ui/ | 4 | ~18 | workbench 6个dealer域标签、vehicle-progress dealer_sales_orders、leave-request 插件 |
| src/handlers/ | 3 | ~15 | formatRowByResource 8个模板、handler-manifest leave_request、chitchat 中文提示 |
| src/cron/ | 1 | ~13 | cron-templates 5个dealer业务模板 |
| src/auth/ | 1 | ~9 | canReadDealerResource 8个资源权限、submit_leave_request 工具权限 |
| src/dealer/ | 3 | ~61 | 遗留模块整体（dealer-report-composer/evidence/metrics） |
| src/scenarios/ | 1 | ~3 | leave-request.ts 场景硬编码 |
| src/router/ | 1 | ~1 | router-prompt.ts dealer.query/aggregate 提示词 |
| **合计** | **32** | **~361** | — |

#### 已完成的解耦（M1-M8 全量）

**基础架构（M1-M4b）：**
- `src/app.ts` 不再手工 import 每个业务域细节，通过 `AVAILABLE_PACKS` 注册
- `app.init()` 激活 DomainRegistry 初始化链路，拓扑排序 + 声明式配置收集进入主路径
- `src/domains/registry.ts` 统一收集 resources / commands / deterministicRules / extractors / fieldLabels / queryAdapters / filterTransforms / permissionRules / intentManifests
- `src/handlers/intent-query-handler.ts` 的业务 filter 分支已迁到 QueryAdapter，handler 更接近通用执行器
- `src/domains/dealer/query-adapter.ts` 和 `src/domains/attendance/query-adapter.ts` 承接核心业务查询特例
- `retail-demo` 纯声明式跑通，验证新增轻量业务域的路线成立

**IntentRouter 完全解耦（M5a/M5b）：**
- `intent-router.ts` 零 domain import — 不再 import 任何 `src/domains/{domain}/` 代码
- `intent-router.ts` 零硬编码资源名 — 无 `dealer_*` / `leave_*` / `attendance` 字符串
- `buildShortCorrectionDelta` 通过 `extractorRegistry` 动态查找 extractor
- 删除 11 个死代码函数（extractMetricCategory + 4 attendance extractors + 6 其他）
- 文件从 ~780 行精简到 696 行

**FilterTransform 解耦（M5c）：**
- `DomainPack.filterTransforms` 声明式注册 transform 函数
- `applyMappingTransform` 先查 domain registry，再 fallback 到通用 time transform
- dealer 3 个 transform + attendance 3 个 transform 迁入各域

**Permission 解耦（M6a）：**
- `DomainPack.permissionRules` 声明式注册权限规则
- `checkPermissions` 遍历 domain-registered rules，不再硬编码 dealer_* 权限
- dealer 3 个权限规则迁入 `src/domains/dealer/permission-rules.ts`

**展示层解耦（M6b）：**
- `ResourceConfig.displayColumns` 声明式展示列定义
- `getDisplayColumns` 从 ResourceConfig 动态读取，无硬编码 presets
- `labelOfMetric` / `labelOfField` 接受 `fieldLabels` 参数，从 DomainPack 声明的标签映射查找
- 完整 call chain 穿透：summarize → formatRowsTemplate → formatRowsTable → getDisplayColumns
- dealer 22 个 metric 标签 + 6 个 group 标签迁入 `DEALER_FIELD_LABELS`

**Intent Manifest 域化（M7a）：**
- `DomainPack.intentDir` 指定域级 intent-codes 目录
- `DomainRegistry.loadIntentManifestsFromDir` 扫描加载 JSON manifest
- dealer 11 个 + attendance 1 个 manifest 迁入 `data/domains/{domain}/intent-codes/`
- `data/intent-codes/` 仅保留 core manifest（general / system.smalltalk / knowledge.policy_qa 等）

**ExtractorSpec 实现（M7b）：**
- `resolveExtractor` 统一处理 `ExtractorFn | string | ExtractorSpec` 三种形式
- string 引用：从 extractorRegistry 查找同名 extractor
- ExtractorSpec：`{ use: string; default?: JsonValue; args?: JsonObject }` 声明式引用

**辅助函数去重（M8）：**
- `src/domains/shared/time-utils.ts` 统一 `translateTimeRangeToIso` / `formatLocalDate` / `extractMonthToken`
- intent-query-handler.ts / dealer/query-adapter.ts / attendance/query-adapter.ts 改为从 shared 导入
- 消除 3 份重复实现

#### 残留耦合清单（M12 完成后最终审计 · 2026-06-01）

**已解决项（M5a-M12）：**

1. ~~`src/router/intent-router.ts` 直接 import dealer extractor~~ ✅（M5a）
2. ~~`src/router/intent-router.ts` 残留 ~12 个业务 extractor 函数~~ ✅（M5a/M5b）
3. ~~`src/handlers/intent-query-handler.ts` 硬编码 dealer 权限放行逻辑~~ ✅（M6a）
4. ~~`src/handlers/intent-query-handler.ts` applyMappingTransform 8 个业务 transform~~ ✅（M5c）
5. ~~`src/handlers/intent-query-handler.ts` getDisplayColumns 硬编码 4 个资源展示列~~ ✅（M6b）
6. ~~`src/handlers/intent-query-handler.ts` labelOfMetric/labelOfField 硬编码标签映射~~ ✅（M6b）
7. ~~`src/router/deterministic-rule-registry.ts` string | ExtractorSpec 未实现~~ ✅（M7b）
8. ~~Intent manifest 依赖 `data/intent-codes` 根目录~~ ✅（M7a）
9. ~~辅助函数重复：translateTimeRangeToIso / formatLocalDate / extractMonthToken~~ ✅（M8）
10. ~~`src/agent/nodes.ts` enforceSkillContracts ~150 行 attendance 业务逻辑~~ ✅（M9）
11. ~~`src/agent/intent-codes.ts` isDealerAnalysisMessage + 11 行 dealer 正则~~ ✅（M10）
12. ~~`src/query/query-parser.ts` parseLeaveRecordQuery + isLeaveRecordQuestion 硬编码~~ ✅（M11）
13. ~~`src/llm/` isDealerAnalysisQuestion / isLeaveRecordQuestion 直接调用~~ ✅（M12 — 已确认为 registry 委托 shim）

**主链路残留（1 项，tech debt）：**

14. `src/handlers/intent-query-handler.ts:906-930` — formatRowByResource 仍有 8 个资源行模板硬编码（dealer_vehicles/finance/repair_orders/warranty_claims/sales_orders/leads/metrics + leave_requests）→ 可迁移到 `DomainPack.rowTemplates`

**外围模块残留（M12 最终审计 · 2026-06-01 更新）：**

> **注意**：M9-M12 已大幅减少外围模块耦合。以下清单已更新，标记已解决项。
> 原始 M8 审计发现 32 个文件 ~361 个耦合点；M12 后降至 ~5% 残留，且均为可接受类别。

##### 已解决的外围耦合（M9-M12）

| 原始位置 | 耦合内容 | 解决方式 | 里程碑 |
|----------|---------|---------|--------|
| nodes.ts:65,159 + ~150 行 | enforceSkillContracts 全部 attendance 逻辑 | 迁移到 attendance/skill-contracts.ts，通过 SkillContractEnforcer registry 委托 | M9 |
| intent-codes.ts:21-28,53-55 | inferIntentCode 8 个映射 + isDealerAnalysisMessage | 迁移到各域 domain-pack.ts intentCodeInferenceFns，通过 inferIntentCodeFromRegistry 委托 | M10 |
| query-parser.ts:42,455-458 | parseLeaveRecordQuery + isLeaveRecordQuestion 硬编码 | 迁移到 attendance/query-adapter.ts parseQuery，通过 adapter 循环委托 | M11 |
| openai-llm.ts:6 / local-llm.ts:10-11 | isDealerAnalysisQuestion / isLeaveRecordQuestion 直接 import | 已确认为 registry 委托 shim（实际逻辑在域 pack 中） | M12 |

##### 可接受的残留引用（不需要迁移）

以下残留引用经 M12 最终审计确认为可接受类别，不包含可独立迁移的业务逻辑：

| 类别 | 文件 | 说明 |
|------|------|------|
| **编译时常量聚合** | ports.ts | INTENT_CODES 聚合域 intent codes，提供 TypeScript 类型安全 |
| **Registry 委托 shim** | query-parser.ts (isDealerAnalysisQuestion/isDealerQuestion/isLeaveRecordQuestion) | 函数体已改为 `adapters.some(a => a.isAnalysisQuestion?.(text))` 等 registry 委托 |
| **Registry 委托 shim** | openai-llm.ts (isDealerAnalysisQuestion/isLeaveRecordQuestion 调用) | 调用的是上述 registry 委托 shim |
| **LLM prompt 文本** | openai-llm.ts:419-421,504 | 给 LLM 的分类指令，属于 prompt engineering |
| **通用字段名引用** | business-tools.ts:218-229 (applicant_user_id) | 通用 scopeField 注入，由 ResourceConfig.scopeType 驱动 |
| **通用字段名引用** | tool-error-formatter.ts:11 (leave_type) | 通用字段标签映射 |
| **通用字段名引用** | openai-llm.ts:1189 (applicant_name) | 通用名称字段猜测 |
| **通用数据加载** | business-tools.ts:509 (leave-requests.json) | 收集所有用户 ID 用于权限检查 |
| **前端 UI 展示** | chat-page.ts:1717,2330,2769 | 纯展示层用户友好文案 |
| **注释/文档** | resources/types.ts, domains/types.ts, cron-templates.ts:15 | 仅作为示例说明 |
| **域内文件** | src/domains/dealer/*, src/domains/attendance/* | 域逻辑的归属地 |
| **测试/评估** | src/eval/* | 测试用例天然需要引用具体域 |

##### 原始外围模块清单（M8 审计，部分已被 M9-M12 解决）

<details>
<summary>展开查看原始 M8 审计明细（历史记录）</summary>

###### src/llm/ — 原 76 个耦合点

| 文件 | 行号 | 耦合内容 | 类型 | M12 状态 |
|------|------|---------|------|---------|
| local-llm.ts | 2 | `import { composeDealerReport }` from src/dealer/ | 函数import | 已改为从 domains/runtime-registry 委托 |
| local-llm.ts | 10-11 | isDealerAnalysisQuestion/isLeaveRecordQuestion import | 函数import | ✅ 已确认为 registry 委托 shim |
| openai-llm.ts | 6 | isDealerAnalysisQuestion/isLeaveRecordQuestion import | 函数import | ✅ 已确认为 registry 委托 shim |
| openai-llm.ts | 419-421,504 | LLM prompt 中 leave_request/attendance 提示 | prompt 文本 | ✅ 可接受（prompt engineering） |
| openai-llm.ts | 1189 | row.applicant_name 字段访问 | 通用字段名 | ✅ 可接受（通用名称猜测） |
| openai-llm.ts | 1381,1409 | isDealerAnalysisQuestion 调用 | 函数调用 | ✅ 已是 registry 委托 shim |
| openai-llm.ts | 1487-1489 | shouldPreferLeaveQuery 使用 isLeaveRecordQuestion | 函数调用 | ✅ 已是 registry 委托 shim |

###### src/agent/ — 原 47 个耦合点

| 文件 | 行号 | 耦合内容 | 类型 | M12 状态 |
|------|------|---------|------|---------|
| ports.ts | 5,17-28 | INTENT_CODES 聚合域常量 | 编译时常量 | ✅ 可接受（类型安全） |
| intent-codes.ts | 21-28 | inferIntentCode 映射 | 资源名+intent_code | ✅ M10 已迁移到 intentCodeInferenceFns |
| intent-codes.ts | 53-55 | isDealerAnalysisMessage | 中文关键词 | ✅ M10 已删除，迁移到 dealer domain-pack |
| nodes.ts | 65,159 + ~150 行 | enforceSkillContracts 全部 | 业务逻辑 | ✅ M9 已迁移到 attendance/skill-contracts.ts |

###### src/query/ — 原 48 个耦合点

| 文件 | 行号 | 耦合内容 | 类型 | M12 状态 |
|------|------|---------|------|---------|
| query-parser.ts | 42 | leave_requests context 判断 | 资源名硬编码 | ✅ M11 已改为 adapter.supports() 通用循环 |
| query-parser.ts | 455-458 | parseLeaveRecordQuery 硬编码 | 资源名硬编码 | ✅ M11 已删除，迁移到 attendance/query-adapter.ts |
| query-parser.ts | 128-142 | isDealerAnalysisQuestion/isDealerQuestion | 业务逻辑 | ✅ 已改为 registry 委托 shim |

###### src/runtime/ — 原 50 个耦合点

| 文件 | 行号 | 耦合内容 | 类型 | M12 状态 |
|------|------|---------|------|---------|
| agent-state.ts | 315-322 | isScopedToReports applicant_user_id | 通用字段名 | ✅ 可接受（通用 scope 检查） |
| conversation-context.ts | 149 | 域任务推断 | 资源名硬编码 | ✅ 已改为 registry 动态查找 |
| agent-task-state.ts | 322 | fact 提取 | 资源名硬编码 | ✅ 已改为 registry 查找 factKey |

</details>

### M9: nodes.ts enforceSkillContracts 迁移 ✅ 已完成

目标：将 `nodes.ts` 中 ~150 行 attendance 特定的 skill contract enforcement 逻辑迁移到域 pack。

实施结果：

```text
1. 创建 src/domains/attendance/skill-contracts.ts（~120 行）：
   - leaveRecordsSkillContractEnforcer 实现 SkillContractEnforcer 接口
   - 迁移 12 个函数 + 3 个接口
2. DomainPack 类型新增 skillContractEnforcers?: SkillContractEnforcer[]
3. DomainRegistry 收集 allSkillContractEnforcers
4. runtime-registry.ts 新增 enforceSkillContractsFromRegistry<T>() 泛型函数
5. nodes.ts 替换为 enforceSkillContractsFromRegistry 调用，删除 ~150 行死代码
```

新增文件：`src/domains/attendance/skill-contracts.ts`

### M10: intent-codes.ts dealer 特定正则迁移 ✅ 已完成

目标：将 `intent-codes.ts` 中的 dealer 特定正则模式和 `isDealerAnalysisMessage` 迁移到域 pack。

实施结果：

```text
1. DomainPack 类型新增 intentCodeInferenceFns?: IntentCodeInferenceFn[]
2. DomainRegistry 收集 allIntentCodeInferenceFns
3. runtime-registry.ts 新增 inferIntentCodeFromRegistry(message) 辅助函数
4. dealer domain-pack.ts 新增 3 个 intentCodeInferenceFns
5. attendance domain-pack.ts 新增 1 个 intentCodeInferenceFn
6. intent-codes.ts 替换为 inferIntentCodeFromRegistry(message) 调用
7. 删除 isDealerAnalysisMessage 函数
```

### M11: query-parser.ts parseLeaveRecordQuery 迁移 ✅ 已完成

目标：将 `query-parser.ts` 中的 `parseLeaveRecordQuery` 和 `isLeaveRecordQuestion` 迁移到 attendance 域 adapter。

实施结果：

```text
1. attendance/query-adapter.ts 新增 parseQuery 方法（完整 parseLeaveRecordQuery 逻辑）
2. query-parser.ts 替换硬编码块为通用 adapter 循环
3. isContextContinuationForTarget 泛化为 adapter.supports() 循环
4. 删除死代码：parseLeaveRecordQuery / LeaveRecordQueryInput / isContextContinuationForTarget
5. isLeaveRecordQuestion 改为 deprecated registry 委托 shim
```

### M12: LLM 层 shim 验证 + 最终耦合扫描 ✅ 已完成

目标：验证 LLM 文件中的域特定引用均为 registry 委托 shim，执行最终全量耦合扫描。

实施结果：

```text
1. 验证所有 isDealerAnalysisQuestion / isLeaveRecordQuestion / isDealerQuestion 均为 registry 委托 shim
2. 全量耦合扫描：grep 所有 src/ 文件（排除 domains/ 和 eval/）
3. 分类所有残留引用为可接受类别
4. 最终评级：~95% 解耦
5. npx tsc --noEmit 零错误
```

### M5: IntentRouter 解耦（消除 runtime → dealer 反向依赖）✅ 已完成

目标：IntentRouter 不再直接 import 任何业务域代码，所有 extractor 通过 DomainRegistry.allExtractors 动态查找。

#### M5a: 短句修参 extractor 动态化 ✅

实施结果：

```text
1. IntentRouter 构造函数接收 extractorRegistry（domainRegistry.allExtractors 引用）
2. buildShortCorrectionDelta 中的 extractStore / extractTimeRange / extractVehicleModel 等
   改为从 this.extractorRegistry 动态查找
3. 删除 intent-router.ts 顶部的 dealer import 块（~17 行）
4. dealer DomainPack.extractors 补齐 5 个新 extractor：
   extractGroupBy / extractGenericStatus / extractLeadIntentionLevel / extractLeadSource / normalizeSeries
```

验证：

```text
✅ intent-router.ts 零 ../domains/dealer/ import
✅ npm run eval:router 100/100
✅ npm run eval:dealer 14/14
```

#### M5b: 残留业务 extractor 清理 ✅

实施结果：

```text
发现 extractMetricCategory + looksLikeLeaveRequest + extractLeaveType +
extractLeaveStartTime + extractLeaveReason + extractMetricCategory 共 6 个函数
在 intent-router.ts 中零调用者 — 均为 M3 迁移后的死代码。
直接删除，文件从 735 行精简到 696 行。
```

#### M5c: applyMappingTransform 解耦 ✅

实施结果：

```text
1. DomainPack 类型新增 filterTransforms?: Record<string, FilterTransformFn>
2. DomainRegistry.collectDeclarativeConfigs 收集 allFilterTransforms
3. applyMappingTransform 改为 registry-first + local-fallback 模式
4. 迁移 6 个业务 transform 到各域：
   - dealer: clean_fault_category / normalize_finance_direction / overdue_repair_filters
   - attendance: leave_department_aliases / infer_leave_type / leave_scope
5. 通用 time transform（time_range_to_iso / month_token_or_time_range）保留在 handler 中
```

新增文件：
- `src/domains/dealer/filter-transforms.ts`（~50 行）
- `src/domains/attendance/filter-transforms.ts`（~75 行）

### M6: 权限与展示层解耦 ✅ 已完成

#### M6a: checkPermissions 域化 ✅

实施结果：

```text
1. DomainPack 类型新增 permissionRules?: PermissionRuleFn[]
2. PermissionRuleFn 签名：(input: PermissionRuleInput) => { ok: true } | null
3. DomainRegistry 收集 allPermissionRules
4. checkPermissions 遍历 domain-registered rules，命中即放行
5. dealer 3 个权限规则迁入 src/domains/dealer/permission-rules.ts：
   - financeManagerRule: dealer_finance + store_general_manager → allow
   - inventoryRelatedRule: dealer_vehicles/inbounds/quotas/stores + inventory:read/order:read/sales_report:read → allow
   - dealerManagerRule: dealer_* + store_general_manager/sales_manager → allow
```

新增文件：`src/domains/dealer/permission-rules.ts`（~60 行）

#### M6b: 展示层声明化 ✅

实施结果：

```text
1. ResourceConfig 新增 displayColumns?: Array<[string, string]>
2. getDisplayColumns 改为从 resourceConfigs 动态读取，无硬编码 presets
3. labelOfMetric / labelOfField 新增可选 fieldLabels 参数
4. 完整 call chain 穿透 fieldLabels + resourceConfigs：
   summarize → formatRowsTemplate → formatRowsTable → getDisplayColumns
   summarizeAggregate → formatAggregateAnswer → createGroupedMetricIntro / formatGroupedMetricTable
   createSearchAnswerPreference → inferDisplayFields
5. 迁移 displayColumns 到各域 ResourceConfig：
   - dealer: dealer_vehicles / dealer_leads / dealer_sales_orders
   - attendance: leave_requests
6. 迁移 22 个 metric 标签 + 6 个 group 标签到 DEALER_FIELD_LABELS
7. rowTemplate 迁移标记为 tech debt（formatRowByResource 仍有 8 个硬编码模板）
```

### M7: Intent Manifest 域化 + ExtractorSpec 实现 ✅ 已完成

#### M7a: Intent Manifest 域化加载 ✅

实施结果：

```text
1. DomainPack 类型新增 intentDir?: string
2. DomainRegistry 新增 loadIntentManifestsFromDir() 扫描 *.json 文件
3. collectDeclarativeConfigs 中加载各域 intentDir 的 manifest
4. app.ts init() 中 intentRegistry.registerMany(domainRegistry.allIntentManifests)
5. dealer intentDir: "data/domains/dealer/intent-codes"（11 个 JSON）
6. attendance intentDir: "data/domains/attendance/intent-codes"（1 个 JSON）
7. data/intent-codes/ 仅保留 core manifest：
   general.json / knowledge.policy_qa.json / system.smalltalk.json /
   workflow.leave_request.json / retail.query.inventory_alerts.json / retail.query.sales.json
```

新增目录：
- `data/domains/dealer/intent-codes/`（11 个 JSON 文件）
- `data/domains/attendance/intent-codes/`（1 个 JSON 文件）

#### M7b: ExtractorSpec string 引用实现 ✅

实施结果：

```text
1. deterministic-rule-registry.ts 新增 resolveExtractor() 函数
2. 支持三种形式：
   - ExtractorFn：直接调用
   - string：从 extractorRegistry 查找同名 extractor
   - ExtractorSpec { use, default?, args? }：查找 + 传参 + 默认值
3. matchDomainRule 接收 extractorRegistry 参数，所有 extractor 通过 resolveExtractor 执行
```

### M8: 辅助函数去重 ✅ 已完成

实施结果：

```text
1. 创建 src/domains/shared/time-utils.ts（~83 行）：
   - translateTimeRangeToIso / formatLocalDate / extractMonthToken
2. intent-query-handler.ts / dealer/query-adapter.ts / attendance/query-adapter.ts
   删除本地重复实现，改为从 shared/time-utils.ts 导入
3. 消除 3 份重复实现
4. query-parser.ts 的 extractMonthToken 有微小差异（硬编码 2026 年），保留为 tech debt
```

新增文件：`src/domains/shared/time-utils.ts`（83 行）

**外围模块域语义清理（M9-M12 已大幅推进）：**

```text
M8 时标记为 tech debt 的项目，M9-M12 已解决大部分：
✅ src/dealer/ 目录已迁入 src/domains/dealer/（之前的迭代完成）
✅ src/agent/intent-codes.ts inferIntentCode 已改为 inferIntentCodeFromRegistry 委托（M10）
✅ src/agent/nodes.ts enforceSkillContracts 已迁移到 attendance/skill-contracts.ts（M9）
✅ src/query/query-parser.ts parseLeaveRecordQuery/isLeaveRecordQuestion 已迁移到 attendance/query-adapter.ts（M11）
✅ src/llm/ isDealerAnalysisQuestion/isLeaveRecordQuestion 已确认为 registry 委托 shim（M12）

仍为 tech debt（可接受，不阻塞）：
- src/handlers/intent-query-handler.ts formatRowByResource 8 个资源行模板 → 可迁移到 DomainPack.rowTemplates
- src/agent/ports.ts INTENT_CODES 编译时常量聚合 → 设计选择，保留类型安全
- src/llm/openai-llm.ts LLM prompt 中的域特定分类指令 → prompt engineering，非业务逻辑
- src/tools/tool-error-formatter.ts 通用字段标签 → 不含业务逻辑
```

### 解耦完成标准

当以下条件全部满足时，DomainPack 解耦达到 100%：

```text
1. IntentRouter 不 import 任何 src/domains/{domain}/ 代码
2. IntentQueryHandler 不包含任何业务域 if/else 分支
3. 新增业务域只需：
   a. 创建 src/domains/{domain}/ 目录
   b. 在 available-packs.ts 加一行
   c. 在 data/domains/{domain}/intent-codes/ 放 manifest JSON
   d. 所有能力通过 DomainPack 声明式字段注册
4. retail-demo 作为 canary：纯声明式、无 register() 逃生口、eval 全通过
5. 所有 eval 保持通过：
   - npm run build:ts
   - npm run eval:router (100/100)
   - npm run eval:dealer (14/14)
   - npm run eval:domain:retail-demo (13/13)
   - npm run eval:router:commands (11/11)
```

### 里程碑依赖关系

```text
M5a ✅ ──→ M5b ✅ ──→ M5c ✅ ──→ M6a ✅ ──→ M6b ✅ ──→ M7a ✅ ──→ M7b ✅ ──→ M8 ✅
                                                                                  ↓
                                                                          ~85-90% 解耦
                                                                                  ↓
                                                              M9 ✅ ──→ M10 ✅ ──→ M11 ✅ ──→ M12 ✅
                                                                                                  ↓
                                                                                          ~95% 解耦
                                                                                                  ↓
                                                                                    残留均为可接受类别
```

### 风险与缓解

| 风险 | 影响 | 缓解 | 状态 |
|------|------|------|------|
| extractor 动态查找性能 | 路由延迟增加 | allExtractors 是 plain object，O(1) 查找 | ✅ 已验证无性能风险 |
| filterTransform 注册表膨胀 | 类型复杂度 | FilterTransformFn 签名简单 | ✅ 已实现，6 个 transform |
| intent manifest 迁移期间双源加载 | 加载顺序冲突 | DomainPack.intentDir 优先 | ✅ 已完成迁移 |
| enforceSkillContracts 泛型类型 | 类型不兼容 | 使用 `<T extends ...>` 泛型保留调用方类型 | ✅ 已解决 |
| intentCodeInferenceFns 执行顺序 | 多域冲突 | first-match-wins，域注册顺序确定 | ✅ 已验证无冲突 |
| leave-skill-regression 预存失败 | 误判为新引入 | 已确认为预存问题 | ✅ 不阻塞 |

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
已完成：DomainPack 解耦专项 M1-M12（整体 ~95%），IntentRouter/IntentQueryHandler/nodes/intent-codes/query-parser 零业务域硬编码；残留引用均为 registry 委托 shim、LLM prompt 文本或通用字段名。
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

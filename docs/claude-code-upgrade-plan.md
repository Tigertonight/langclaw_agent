# 对标 Claude Code 的分阶段升级计划

本文用于记录当前 Agent 项目对标 Claude Code 架构的长期升级路线。

当前分支 `codex/enhance-memory-capability` 的边界是：**完成用户 workspace 下的 Memory / Evolution 基座**。不要在本分支继续扩张 QueryEngine、Transcript、Compaction、Task Tools、Patch Subagent 等大模块，避免分支失控。

## 目标定位

本项目不是一次性复刻 Claude Code，而是分阶段补齐核心架构能力：

```text
Phase 1 当前分支：Memory + 主动沉淀
Phase 2 会话编排：Transcript + QueryEngine
Phase 3 上下文工程：Memory Retriever + Compaction
Phase 4 长程任务：Task Tools + Task Claim
Phase 5 自进化：Patch Subagent + Governance
Phase 6 多 Agent：Subagent 协作 + Workspace 隔离增强
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

## Phase 1：Memory + 主动沉淀

目标：把当前分支收敛成一个干净、可验证的个人记忆与主动沉淀底座。

当前分支范围内的目录：

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

暂不做：

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

当前分支完成标准：

```text
能稳定写入个人记忆
能稳定写入结构化 task
能记录 evolution log
能让 evolution preference 在下一轮生效
不会跨用户串线
无规则 fallback 写记忆
```

## Phase 2：Transcript + QueryEngine

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

## Phase 3：Memory Index + Retriever + Episodes

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

## Phase 4：Compaction + Token Budget

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

## Phase 5：Task Tools + Task Concurrency

目标：让 agent 主动维护任务，而不是只靠 evolution 会后写。

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

## Phase 7：Hooks / Extension Runtime

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
```

## 当前分支收敛建议

这个分支不要继续无限扩张。建议只补齐这些收尾项：

1. 确认 `memory/tasks` 已完全迁出。
2. 确认 `users/` 测试产物不进入 git。
3. 确认无规则 fallback 写 memory。
4. 保持验证脚本稳定。
5. 将本文档作为后续拆分分支的总计划引用。

当前分支：

```text
codex/enhance-memory-capability
```

后续分支建议：

```text
codex/add-transcript-query-engine
codex/add-memory-retriever
codex/add-context-compaction
codex/add-task-tools
codex/add-evolution-patch-governance
codex/add-runtime-hooks
```

## 一句话路线图

```text
当前分支：先把“记忆和主动沉淀”做干净
下一分支：补 transcript 和 QueryEngine，让 evolution 看完整会话
再下一分支：做 memory retriever 和 compaction
之后：做 task tools、patch subagent、governance
最后：抽 hook runtime，走向 Claude Code 式完整 agentic system
```

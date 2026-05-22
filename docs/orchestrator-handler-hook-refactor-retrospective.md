# Orchestrator / Handler 到 Hook Runtime 插件化复盘

## 1. 背景与结论

当前系统最初以 `orchestrator + handler` 为核心组织运行链路：`orchestrator` 负责用户识别、workspace 解析、上下文装配、路由分发、session 保存、transcript 记录、最终响应收口；`handler` 负责具体执行路径，例如 `intent_query`、`chitchat`、`knowledge_lookup`、`agentic`。

这个设计在早期是合理的。它让 MVP 可以快速跑通从用户消息到业务回答的完整闭环，降低了调试成本，也避免一开始就过度抽象。但随着 Memory / Evolution / Task / Transcript / Governance / Skill Curator / Scheduler 等能力进入系统，越来越多能力不再属于某一个 handler，而是横跨整条运行生命周期。继续放在 `orchestrator/handler` 里，会让主链路变重、变脆，也会让每个新能力都倾向于新增一个硬编码分支。

因此，当前拆分方向不是推翻原架构，而是把 `orchestrator/handler` 重新定位为“主流程骨架”，把横切能力逐步迁移到 `Hook Runtime + Plugin`：

- `orchestrator` 保留：身份、workspace、路由、分发、响应收口、关键生命周期事件 emit。
- `handler` 保留：面向某一执行模式的核心业务处理。
- `hook/plugin` 接管：记忆沉淀、任务连续性、skill 生命周期、主动维护调度、治理审计、指标观测、回放与调试等横切能力。

产品视角的核心判断是：当系统目标从“能回答”升级到“长期陪伴、主动维护、自我进化”后，横切能力会成为体验主体。它们不能继续依附在单个 handler 的内部实现里。

## 2. 当时为什么选择 Orchestrator / Handler

早期的主要目标是让 agent 具备稳定的问答和业务工具调用能力。这个阶段最重要的不是插件化，而是端到端闭环：

- 能识别用户和权限。
- 能把用户放到正确 workspace。
- 能加载企业上下文。
- 能路由到受控执行或 agentic 执行。
- 能调用工具、组织回答、保存 session。
- 能输出可调试的 debug 信息。

在这个目标下，`orchestrator` 作为单一运行入口很合适。它像产品里的“交易主链路”：所有关键状态都经过它，方便快速定位问题，也方便在早期缺少完整观测体系时做调试。

`handler` 的引入也符合当时的产品分层：

- `IntentQueryHandler` 负责确定性结构化查询。
- `ChitchatHandler` 负责轻量对话。
- `knowledge_lookup` 负责知识检索。
- `AgenticHandler` 负责跨意图规划和工具循环。

这种拆分把“不同执行模式”隔离开了，避免所有逻辑堆在一个函数里。早期需要的是清晰的主干，而不是完整生态。

## 3. 当时是否考虑过扩展性

有考虑，但考虑的是“执行模式扩展”，不是“横切能力扩展”。

当时的扩展性主要体现在：

- router 可以返回不同 `handler_type`。
- tool registry 可以注册新工具。
- skill runtime 和 agentic skill view 可以扩展 skill。
- session store、enterprise context、knowledge base 都是可替换服务。
- agentic handler 预留了 `intent.* / skill.* / tool.*` 三类能力入口。

这些设计解决的是“agent 可以做更多事”的问题。但 Memory / Evolution 之后出现的是另一类问题：同一个用户生命周期中，系统需要在很多节点旁路观察、沉淀、治理、调度、回放。

例如：

- turn 开始时要记录用户输入。
- tool 执行后要收集证据。
- turn 结束后要写 transcript、触发 evolution、刷新 skill TTL。
- session idle 后要做 conversation-level judge 或 scheduler。
- patch apply 后要更新 curator 和 governance。
- task 状态变化后要产生 trace 和检索索引。

这些并不是某一个 handler 的职责。它们需要一个运行时事件层。

所以，当时的架构并非没有扩展性，而是扩展性维度和现在的系统目标不同。当目标从“扩展工具和执行路径”变成“扩展长期智能能力”，原来的扩展点就不够用了。

## 4. 当前 Orchestrator / Handler 实际承担了哪些逻辑

当前 `orchestrator` 已经承担了多类职责：

- 运行入口：解析 user、workspace、sessionId。
- 上下文装配：加载 enterprise context、conversation context。
- 路由控制：调用 intent router，判断 controlled execution 或 autonomous planning。
- 分发执行：进入 intent query、chitchat、knowledge lookup、workflow、agentic。
- 流式输出：SSE thinking、route、agentic event、delta、done。
- session 管理：recent messages、recent routes、history、active intent。
- debug 汇总：tool calls、tool results、agent steps、enterprise context 摘要。
- transcript 写入：turn 结束写持久化轨迹。
- evolution 触发：finish 后 collectTurn，并 emit `session_idle`。
- hook emit：`turn_start`、`turn_end`、`session_idle`。

当前 `AgenticHandler` 也开始承担横切职责：

- 获取可用 intent / skill / tool。
- 执行 LLM planning loop。
- skill 注入。
- tool 调用。
- fallback。
- task retrieval。
- task continuity claim。
- task progress evidence 写入。
- agentic 三流 traces。

这说明系统已经进入“横切能力自然增长”的阶段。Memory、Task、Skill、Evolution 都不是孤立模块，它们会不断寻找主链路的入口。如果没有统一 hook/plugin 层，每个能力都会直接钻进 orchestrator 或 handler。

## 5. 为什么现在要拆

### 5.1 产品能力从响应式变成长期式

早期用户体感是：“我问，agent 答。”

现在目标是：“agent 记得我、理解连续任务、会主动沉淀、会维护自己的技能、会在我没说话时帮我盯着。”

这种体验不是某一次回答产生的，而是由很多后台动作叠加产生的。比如：

- 这次对话结束后，是否沉淀成 memory。
- 多轮任务是否被识别成同一个 task。
- 某个 skill 是否因为长期不用而降级。
- patch 是否需要审批和回滚。
- 是否能在 idle 或 nightly 自动跑维护任务。

这些动作必须围绕生命周期事件发生，而不是散落在某个 handler 的末尾。

### 5.2 降低主链路复杂度

`orchestrator` 的价值是稳定、可预测、可调试。它越重，每次新增能力的风险越高。

如果每个能力都在 `finish()`、`runAgentic()`、`scheduleEvolution()` 里加逻辑，后续会出现几个问题：

- 很难判断一个 turn 结束后到底触发了什么。
- 新能力之间容易互相影响。
- 测试需要覆盖整个 orchestrator，成本越来越高。
- 失败隔离差，一个非关键能力可能影响主回答。
- 代码阅读者会把主流程和旁路能力混在一起理解。

Hook Runtime 的作用是让主链路只负责发出事实事件，插件负责订阅和处理。

### 5.3 支持能力渐进启用和治理

Memory / Evolution 这类能力不是“一次写死”的能力。它需要可观测、可关闭、可回滚、可灰度。

插件化天然适合这些需求：

- 某个插件可以按 workspace/user 开关。
- 插件可以单独记录运行结果。
- 插件失败可以被捕获，不阻断主回答。
- 插件可以在 eval 中单独冒烟。
- 插件之间可以按生命周期事件解耦。

这对 B 端也更友好。客户不一定一开始就接受所有自主能力，但可以先打开 memory，再打开 scheduler，再打开 patch subagent。

## 6. 如果当时就采用 Hook / Plugin 是否更好

答案是：不一定。

如果项目一开始就做完整 hook/plugin，短期很可能变慢。原因是早期我们还不知道哪些生命周期事件稳定、哪些上下文一定需要、哪些能力会成为核心。过早抽象容易产生一个“看起来高级但没有真实需求校验”的插件系统。

早期更重要的是跑通：

- 用户 workspace 隔离。
- 权限和工具调用。
- router 与 handler 分工。
- agentic loop 的基本可用性。
- session 和 debug。

这些主链路稳定之后，再抽 hook/plugin，反而能基于真实使用痛点设计事件：

- `turn_start`
- `tool_result`
- `turn_end`
- `session_idle`
- `task_change`
- `evolution_applied`

所以更准确的复盘不是“当时应该一开始就 plugin 化”，而是：

早期选择 orchestrator/handler 是正确的，但在 Memory / Evolution 进入主线后，应该更早设立一个架构红线：凡是跨 handler、跨 turn、跨 session、跨 workspace 生命周期的能力，都不能继续直接塞进 orchestrator/handler，而必须通过 hook/plugin 注册。

## 7. 当前拆分原则

### 7.1 Orchestrator 保留什么

`orchestrator` 应该保留不可替代的主流程职责：

- user/workspace/session 解析。
- enterprise context 装配。
- intent router 调用。
- handler 分发。
- response 收口。
- transcript 基础写入。
- lifecycle event emit。
- 主链路 debug 摘要。

它不应该直接理解 skill curator、memory compaction、scheduler、patch governance 的内部策略。

### 7.2 Handler 保留什么

`handler` 应该保留某一执行模式内部的核心逻辑。

例如 `AgenticHandler` 可以继续负责：

- LLM planner prompt。
- tool/skill/intent 可用能力列表。
- tool call 执行。
- observation 汇总。
- answer 生成。
- agentic traces。

但 task continuity、memory evidence、skill usage、tool result learning 等能力，应逐步迁出 handler，变成 hook/plugin。

### 7.3 Hook Plugin 接管什么

适合进入 plugin 的能力有四个判断标准：

- 跨多个 handler 都需要。
- 不影响主回答成功与否。
- 依赖生命周期事件，而不是某个业务分支。
- 需要独立开关、审计、回滚或灰度。

当前已适合插件化的能力：

- SignalCollector：订阅 `turn_end/session_idle`，聚合 transcript/session trace。
- Memory Learner：订阅 conversation-level signal，写 memory。
- Task Maintainer：订阅 message/tool_result/turn_end，维护 task evidence。
- Skill Curator：订阅 `turn_end/evolution_applied`，刷新 TTL、usage、patch count。
- Maintenance Scheduler：订阅 `session_idle` 或外部 timer，运行 nightly/weekly 任务。
- Governance Logger：订阅 patch/apply/rollback/restore，写审计。
- Metrics/Observability：订阅所有 hook，输出运行指标。

## 8. 分阶段迁移路线

### Phase 1：事件标准化

目标是让 hook event 的 payload 足够稳定。

需要补齐：

- `turn_start` 包含 user、workspace、session、message。
- `tool_result` 包含 tool call、result、latency、error。
- `turn_end` 包含 route、answer、tool summary、agent steps、workspace。
- `session_idle` 区分真实 idle 与 finish 后异步触发。
- `task_change` 包含 before/after。
- `evolution_applied` 包含 target、artifact、governance id。

### Phase 2：新能力必须插件化

从现在开始，新横切能力默认以 plugin 方式接入。

已经符合这个方向的能力：

- `skill-curator` plugin。
- `maintenance-scheduler` plugin。

后续新增：

- dependency scan 报告沉淀为 episode。
- memory compaction 定时化。
- patch approval notification。
- transcript replay index refresh。

### Phase 3：迁移已有横切逻辑

优先迁移那些已经让 handler 变重的逻辑：

- `AgenticHandler.prepareTaskContext()` 中的主动 task retrieval/claim。
- `AgenticHandler.recordTaskProgress()` 中的 evidence 写入。
- `orchestrator.scheduleEvolution()` 中的 evolution signal 触发。
- `finish()` 中 transcript 与 debug 的旁路写入。

迁移方式不是一次性重写，而是每次改相关能力时顺手抽离。主流程保持稳定。

### Phase 4：插件治理面

当 plugin 增多后，需要管理面：

- plugin list。
- plugin enable/disable。
- plugin recent events。
- plugin failure log。
- plugin per-workspace config。
- plugin dry-run。

这会让“自主运行”从技术能力变成可售卖的产品能力。

## 9. 产品视角的价值

这次拆分不是为了代码优雅，而是为了三个产品结果。

第一，用户会感觉 agent 更聪明。

因为记忆、任务连续性、主动维护、skill 生命周期不是靠某次回答硬凑出来，而是系统持续运行的结果。

第二，客户会更信任 agent。

因为每个自主演化动作都有来源、事件、审计、回滚，而不是藏在主回答逻辑里。

第三，团队能更快加能力。

后续要做新的“长期智能模块”，不需要理解整个 orchestrator，只需要订阅标准事件并交付插件。

## 10. 最终判断

当时采用 orchestrator/handler，是为了把 MVP 主链路跑通，这是正确选择。

现在逐步拆到 Hook Runtime，也是正确选择，因为系统目标已经从“任务回答”升级到“长期智能体运行时”。

如果一开始就做完整 plugin system，可能会过早复杂化；但当 Memory / Evolution 成为主线后，继续把横切能力写进 orchestrator/handler 就会形成架构债务。

因此当前最合理的策略是：

- 不推翻 orchestrator/handler。
- 不停 feature 开发做大重构。
- 新横切能力必须走 hook/plugin。
- 老逻辑遇到相关改动时逐步迁移。
- 把 Hook Runtime 从“事件记录器”升级为“长期智能能力的运行底座”。

这条路线既保留了早期架构的交付效率，也给后续 Memory、Evolution、Scheduler、Governance 的产品化留下空间。

# 可观测性架构决策（ADR）

> 本文档记录 EnterpriseAgent 可观测性平台立项时的关键架构决策，配套 `observability-tech-spec.md` 是技术方案 + 实施 checklist。

## 立项动机

接 PoC 客户前必须解决三个问题：

1. **复盘**：客户说"今天 agent 答得不好"时，我们能拿出端到端 trace 复现
2. **可解释**：每个路由决策 / 工具选择 / memory 召回都带 reason，能下钻
3. **演化闭环**：知道 evolution 抽出来的 memory 到底有没有让 agent 变好（避免玄学）

合起来对应通用产品语境里的 "trace + replay + score + RAG/agent 专用面板"。这是 Langfuse 类产品的核心场景。

## 关键决策

### ADR-1：选 Langfuse 而非自研

**背景**：可观测性的核心数据模型（trace / span / generation / score）已经被 LLM observability 工具标准化。Langfuse 是其中最成熟、MIT 开源、可自部署的。

**决策**：直接采用 Langfuse 自部署版本作为可观测性后端，**不再自研一遍数据模型和 UI**。

**理由**：
- 我们的需求 70%+ 是 Langfuse 的开箱能力（trace UI / 标注 / token-cost / public API）
- 自研需要至少 2-3 个月才能追上 Langfuse 现有质量
- MIT 开源 + 可自部署 = 企业私有化要求满足
- 万一未来要换：通过 ADR-4 的薄抽象层降低 vendor lock-in

**代价**：
- 自部署 Langfuse 需要 4 个组件（Postgres + ClickHouse + Redis + S3-compatible），运维成本高于纯 SaaS
- Langfuse 的 RAG 召回视图、evolution 闭环视图能力不够，需自建 2 个垂类面板（基于其 Public API）

### ADR-2：物理边界 = `services/observability/` 子项目（L2）

**决策**：在 mono repo 内开 `services/observability/` 子目录，与 `services/memory-service` 同级，独立 package.json / Dockerfile / docker-compose / .env / migrations。

**理由**：
- 边界清晰，能单独部署、独立 CI、独立版本号
- 同 repo 简化跨服务协作（schema 共享、smoke 联调）
- 不上 L3（独立 repo）：现阶段没有外部交付/开源场景，跨 repo 成本过高
- 升级到 L3 的口子保留：当可观测性单独商业化或开源时迁出去

**目录布局**（详见 tech spec）：
```
services/observability/
├── docker-compose.yml          # Langfuse 4 组件 + 自建面板
├── docs/                       # 部署/运维文档
├── dashboards/                 # 自建 RAG / evolution 垂类面板
└── README.md
```

**注意**：Langfuse 本身的代码不进我们 repo。docker-compose 直接拉官方镜像。我们仓库里的 `services/observability/` 主要承载 **部署清单 + 自建面板 + 运维文档**。

### ADR-3：多租户映射 —— 共用 1 个 Langfuse project + business_id 标签

**决策**：默认所有客户共用一个 Langfuse project，`business_id` / `user_id` / `tenant_id` 通过 trace tags + metadata 上报，查询时按 tag 过滤。

**理由**：
- Langfuse 的 project 模型不是为千级别设计的，每客户一项目会爆炸
- 客户原则上**不直接登录** Langfuse —— 他们看我们包装好的垂类面板（基于 Public API + business_id 过滤）
- 内部研发/客户成功登录 Langfuse 后台调试用，按 tag 过滤即可

**预留**：超大客户私有化部署时，单独起一套 Langfuse 实例（D3-c），不影响默认架构。

### ADR-4：在 agent 侧做薄抽象层 `TraceEmitter`

**决策**：agent runtime 不直接 import Langfuse SDK。中间过 `TraceEmitter` 接口（在 `packages/observability-sdk` 内），由 `LangfuseAdapter` 实现具体上报。

**理由**：
- 体现"agent 平台只做数据通信和上报，不耦合能力层"原则
- 给 vendor 切换留口子（未来要换 Phoenix / Helicone / 自研，只动 adapter）
- 抽象层 ~50 行接口代码，成本极低

**接口设计**（精简版）：
```typescript
interface TraceEmitter {
  startTrace(input: TraceInput): TraceHandle;
  span(parentId: string, input: SpanInput): SpanHandle;
  generation(parentId: string, input: GenerationInput): SpanHandle;
  score(traceId: string, name: string, value: number, comment?: string): void;
  flush(): Promise<void>;
}
```

### ADR-5：埋点 SDK 放在 `packages/observability-sdk`，不放业务侧

**决策**：抽出独立 `packages/observability-sdk` npm 包，agent runtime / memory-service / 其他服务都通过引这个包来上报。

**理由**：
- agent runtime 不是唯一上报方：memory-service 自己的 ingest pipeline / embedding worker / search 也要上报 trace
- 多端共用同一抽象层，避免每个服务自己写一遍
- 与 `packages/memory-sdk` 风格一致

### ADR-6：上报通道 = Langfuse SDK 内置 batch（fire-and-forget）

**决策**：起步阶段直接用 Langfuse SDK 的内置 batch + 异步上报机制，不做本地 JSONL 队列。

**理由**：
- Langfuse SDK 已实现 batch / 失败重试 / 内存 buffer
- 我们的产品**绝不能让可观测性成为关键路径**，丢一点 trace 不影响业务
- 实现成本最低，等丢失率被验证不能接受时再升级

**升级路径**：如果生产环境观测到丢失率 > 0.1%，升级到 "本地 JSONL 队列 + 异步 forwarder"（参考 memory-service 离线队列设计）。

### ADR-7：埋点点位 = 复用现有 12 个 RuntimeHook

**决策**：新增 `ObservabilityPlugin`，订阅现有 12 个 hook，不在业务代码里手动埋点。

**理由**：
- runtime 已有完整 hook 体系（message_received / before_route / after_route / before_tool_call / after_tool_call / agent_finish 等）
- 业务代码不需要改动 —— 这是"解耦"的最直接体现
- 与 SubagentPlugin / TranscriptPlugin 同级，三个 plugin 各管各的

**注意**：
- ObservabilityPlugin 必须**严格只读 + 异步上报**，不能让 trace 写阻塞业务流程
- 非 hook 路径的关键埋点（memory-service 内部、tool 执行内部）需要服务自己引 SDK 上报

### ADR-8：垂类面板 2 个 —— RAG 召回下钻 + Evolution 闭环

**决策**：在 Langfuse 通用 UI 之外，自建两个面板：
1. **RAG Recall Inspector**：一个 trace 内召回了哪些 chunk / 各自得分 / 哪些被 LLM 引用
2. **Evolution Loop Dashboard**：抽取速率 / 采纳率 / 回滚率 / 单条 memory 的引用足迹

**理由**：
- Langfuse 的通用 span UI 能看到这些数据，但**呈现不够聚焦**
- 这两类视图是产品决策的核心抓手（C 方向的核心）
- 前端非常薄：调 Langfuse Public API + 自己做表格/图表，不需要重写后端

**技术栈**：Next.js + 调用 Langfuse Public API。**不与 a2UI 复用**（a2UI 是给 agent 输出生成式 UI 用的，语义不同）。

### ADR-9：score（质量打分）双源 —— 人工 + LLM-as-judge

**决策**：trace 的 score 分两种来源
1. **人工标注**：研发/客户成功在 Langfuse UI 里点按钮打分（开箱）
2. **自动评估**：定时任务跑 LLM-as-judge 给最近 N 条 trace 打分，写回 Langfuse

**理由**：
- 单纯人工标注规模上不去
- 单纯自动评估容易和人类判断脱节
- 双源对照能持续校准 judge prompt

**起步只做人工**，自动评估放 Phase 2。

### ADR-10：不在客户对话流程里依赖 Langfuse 在线

**决策**：Langfuse 服务挂掉**绝不能**让对话失败。所有上报路径必须 fire-and-forget，所有 SDK 调用包 try-catch 吞掉异常（仅打日志）。

**理由**：可观测性是旁路，不是关键路径。这是工程纪律，不是技术细节。

## 与现有项目的关系

### 与 a2UI 的关系
不复用。a2UI 是 agent 输出给最终用户看的生成式 UI；可观测性面板是给我们和客户管理员看的内部工具。两者用户和场景完全不同。

### 与 memory-service 的关系
memory-service 自己也是上报方，引 `packages/observability-sdk` 上报：
- ingest pipeline 的 chunk 数 / hash / 耗时
- embedding worker 的批次 / 模型 / 耗时
- search 的混合检索过程（向量得分 / lex 得分 / RRF 排序）

memory-service 上报的 trace 和 agent 上报的 trace 在 Langfuse 中通过 trace_id 串联。

### 与现有 transcript / metrics 的关系
- **transcript** 是用户对话原文留存，**保留**（用于断点恢复、合规审计）
- **现有 metrics** （`/api/metrics`）是简单业务计数器，**保留**（运维侧告警用）
- 可观测性是新增层，承担"产品决策"和"质量回放"，与上面两者数据**部分重合不替代**

## 不做的事（明确边界）

- ❌ **不做**通用 APM（应用性能监控）—— 那是另一个产品（DataDog / NewRelic / 等）
- ❌ **不做**基础设施监控（CPU / 内存 / 网络）—— 那是 Prometheus + Node Exporter 的事
- ❌ **不做**日志聚合（ELK / Loki）—— 与 trace 不同语义，未来需要时单独立项
- ❌ **不做**让客户的最终用户能看到 trace（只给客户管理员和我方研发看）
- ❌ **不做**实时告警（接 Langfuse 后期可考虑，本期不做）

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| Langfuse 自部署 4 组件运维重 | 部署门槛高 | docker-compose 一把起 + 写细 runbook |
| 高并发下 SDK buffer 爆 | trace 丢失 | Phase 2 升级到 JSONL 队列 + forwarder |
| Langfuse 升级 breaking change | adapter 要重写 | TraceEmitter 抽象 + 锁定 minor 版本 |
| 客户敏感数据被上报 | 合规风险 | 上报前 scrub PII + 提供 redact 配置 |
| 自建面板和 Langfuse 双维护 | 长期成本 | 面板尽量薄，复杂逻辑回 Langfuse 主 UI |

## 决策记录

| 决策 | 状态 | 责任人 | 日期 |
|---|---|---|---|
| ADR-1 ~ ADR-10 | 已采纳 | (主导) | 2026-05-28 |

后续 ADR 增量记录在本文档底部。

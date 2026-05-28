# 记忆能力架构决策：GBrain vs 自建

> 日期：2026-05-27
> 状态：暂缓 GBrain 集成，后续按需引入
> 决策范围：企业 agent 长期记忆 / agentic search 能力的承载方案

---

## 背景

引擎层与业务层解耦工作（3-A 至 4-H）已完成，commands:api 回归 19/19。下一阶段目标是为 OpenClaw 增强长期记忆能力，支持：

- 跨会话的事实/偏好/事件沉淀
- 基于记忆的 agentic search（实体关系推理，不只是相似度检索）
- 多 agent 单机部署 + 多租户（business_id）+ 多用户隔离
- 接入方最小代码成本

候选方案是接入 [GBrain](https://github.com/garrytan/gbrain)（带知识图谱的笔记/记忆服务）。

---

## 原始 7 点集成方案（用户提出）

1. GBrain 服务内部新增简单 Agent，通过 MCP 实现服务内闭环
2. GBrain 新增 HTTP 插件接受上游数据
3. GBrain 信任上游传递的用户身份
4. 业务方最小代码实现身份传递（NPM 包 + 抽象类）
5. 写记忆通过 hook 实现，每 5 分钟 timer 整理写入
6. 读记忆通过 tool 暴露给业务 Agent，同步调用
7. 消息持久化包到 GBrain 服务（共用 PG 实例）

---

## GBrain 调研发现

通过 general-purpose agent 对 garrytan/gbrain 仓库的定向调研：

| 维度 | 实际情况 |
|---|---|
| 版本节奏 | 7 周内发布到 v0.41.x，41+ 个 minor 版本，alpha 阶段 |
| 协议形态 | MCP server（85 个 operations），不是 HTTP/REST |
| 存储模型 | markdown + YAML frontmatter + git 版本化 + PGLite |
| 检索能力 | pg_trgm 关键词 + 向量 hybrid，全库检索（无 tenant 维度） |
| 实体识别 | pg_trgm + slugify 名字相似度匹配 |
| 实体链接 | 自动 link，跨笔记合并同名实体 |
| 已知问题 | "phantom-canonical" 实体识别不稳定 |
| 多租户 | **不支持**，single-brain 架构 |
| 实体类型 | 硬编码英文（people / companies / meetings） |
| 社区信号 | 19K stars / 84 watchers（异常社交爆发） |

**关键缺陷**：

1. **single-tenant 架构**：所有数据在一个"大脑"里，pg_trgm 全库检索，entity 自动跨笔记合并
2. **实体识别不暴露给上游**：图谱是内部用的，没有"按关系查询"的 MCP 工具
3. **垂直域不匹配**：硬编码的 people/companies/meetings 实体类型，对 dealer/customer/order 场景无意义
4. **alpha 稳定性**：1.6MB CHANGELOG，每周多个 breaking change

---

## 7 点方案逐条评估（GBrain 路线下）

| # | 内容 | 评估 |
|---|---|---|
| 1 | 内部 Agent 整理记忆 | ⚠️ 整理逻辑应留在 OpenClaw 侧，避免接入方做整理负担 |
| 2 | HTTP 插件 | 🔴 GBrain 原生只有 MCP，需在外面包 HTTP 适配层（实际是你自建一层） |
| 3 | 信任上游身份 | 🔴 GBrain single-tenant，不认 user_id 维度 |
| 4 | 最小代码身份传递 | ✅ NPM 包 + 抽象类思路独立可行 |
| 5 | Hook + timer 写入 | ✅ 独立可行，不依赖 GBrain |
| 6 | 读记忆 tool | ✅ 独立可行 |
| 7 | 消息持久化进 GBrain | ⚠️ 实际是借共享 PG 实例存独立两张表，需注意 schema 边界 |

**关键发现**：7 点中没有任何一条"必须 GBrain 才能做"。

---

## 多租户隔离的核心矛盾

用户的隔离需求：`(business_id, user_id, agent_id?)` 三层 + 多 agent 单机部署。

`business_id` 作为请求 payload 字段（非 header），跟 domain 标签一样作为数据属性流转。

**GBrain 落地此需求的三个选项**：

### 方案 A：frontmatter 打标 + 后置过滤
- 写入：每条 note 加 `business_id` / `user_id`
- 检索：GBrain 全库返回 → 应用层过滤
- 🔴 跨租户相似度排序污染结果，entity 自动 link 跨租户合并是数据泄漏隐患

### 方案 B：每个 (business, user) 一个 GBrain 实例
- 进程级隔离
- 🔴 单机几百进程，运维爆炸

### 方案 C：fork GBrain 改 schema 加 tenant
- 改所有表 + 所有 SQL + 所有 MCP 接口
- 改 entity resolution 改成租户内做
- 🔴 几千行 + 与 v0.41.x 上游永久分叉

**结论**：GBrain 多租户化成本远高于自建。

---

## Agentic Search 与实体链接

用户明确需要 agentic search（不只是相似度检索）。论证：

```
User: "上个月跟我抱怨过售后的客户里，哪些这个月又下单了？"

Agent 内部：
  1. 检索"售后投诉" → 找到客户 A、B、C
  2. 检索"A、B、C 本月订单" → 关联查询
  3. 综合回答
```

需要：**实体稳定 ID + 实体间关系 + 可被 agent 调用的 graph 检索 tool**。

### 实体识别难度分级

| Level | 场景 | 解法 |
|---|---|---|
| 1 | 有明确指代："客户 c_001 下单了" | LLM 抽取 |
| 2 | 强属性匹配："138xxxx 的客户" | 规则 + 业务系统查询 |
| 3 | 模糊指代："张总"、"他媳妇" | 会话上下文 + active entities 池 |
| 4 | 跨会话一致性："上周的张总 == 这周的老张？" | 属性 + embedding 相似度 |

### GBrain 在每层的能力

| Level | GBrain | 你需要的 |
|---|---|---|
| 1 | 不直接做（依赖文本里的名字） | LLM 结构化抽取 |
| 2 | pg_trgm 模糊匹配 | 业务系统主键优先 + LLM fallback |
| 3 | **不支持**（无会话概念） | 会话级 active entities |
| 4 | 自动合并（phantom-canonical 风险） | 建议合并 + 可逆 merge log |

**GBrain 的实体能力 ≠ 你需要的实体能力**。

### 关键论点：业务系统适配层

用户场景中大量实体来自 CRM / DMS / 订单系统。自建记忆服务可以直接查这些业务系统作为 ground truth；GBrain 只能在自己的 markdown 仓里猜测。

这是 GBrain 架构上无法补足的缺口。

---

## 自建 vs GBrain 能力对比

### 核心能力

| 能力 | GBrain (含多租户改造) | 自建瘦版本 | 谁划算 |
|---|---|---|---|
| 多租户隔离 | fork + 几千行 + 永久分叉 | PG 表带 business_id | 🟢 自建 |
| 写入/读取 API | MCP，要包 HTTP 适配 | 原生 HTTP | 🟢 自建 |
| markdown + frontmatter | 原生 | ~50 行 | 🟡 持平 |
| 关键词检索 | 原生 pg_trgm | PG GIN 索引 | 🟡 持平 |
| 向量检索 | 原生 | pgvector | 🟡 持平 |
| 混合检索 | 原生 | ~150 行 | 🟢 GBrain 略优 |
| 实体识别 | pg_trgm（不稳定） | LLM 结构化抽取 | 🟢 自建 |
| 实体链接 | 自动（跨租户合并风险） | 业务系统主键 + 可控策略 | 🟢 自建 |
| 关系图谱查询 tool | 不暴露 | `query_relations` tool | 🟢 自建 |
| 业务系统集成 | 不可能 | 直接查 CRM/DMS | 🟢 自建 |
| 会话 active entities | 不支持 | OpenClaw 侧维护 | 🟢 自建 |

### 工程负担

| 维度 | GBrain | 自建 |
|---|---|---|
| 初次开发 | fork + 多租户改造 ~2-3 周 | 全新写 1.5-2 个月（含实体消解） |
| 稳定性 | v0.41.x alpha | 自控版本 |
| 升级 | 永久 rebase 上游 | 无 |
| 可观测性 | 黑盒 | 全自控 |
| 接入方感知 | 不感知（HTTP 层挡住） | 不感知 |

### 安全合规

| 维度 | GBrain | 自建 |
|---|---|---|
| 租户隔离强度 | 应用层过滤 + entity 跨合并污染 | 表级原生隔离 |
| GDPR 数据导出/删除 | 绕过 GBrain 直接动 PG | 自己的表原生支持 |
| 审计日志 | 要 hook | 想加就加 |

---

## 结论与建议

### 暂缓 GBrain 集成

**核心理由**：

1. 7 点方案中没有任何一条必须依赖 GBrain
2. 多租户改造成本远高于自建
3. GBrain 的实体能力（pg_trgm + 自动 link）不匹配企业 agent 的实体来源（业务系统主键为主）
4. agentic search 所需的"按关系查询"GBrain 不暴露
5. alpha 稳定性对生产 agent 风险高
6. GBrain 的独特价值能力（自动 entity link、git 版本化、内部图谱）在用户场景下要么不需要，要么是隐患

### 推荐路径：自建瘦版本，分阶段推进

**Phase 1（2-3 周）：基础记忆服务**
- 多租户 schema：memories 表带 `business_id` / `user_id`
- HTTP 接口：`/memory` 写、`/memory/search` 读、`/messages` 上报
- 向量 + 关键词检索
- 实体作为字符串存（暂不做消解）
- 接入 SDK：NPM 包 + 身份抽象类 + 读记忆 tool
- OpenClaw 侧 hook + timer 整理逻辑

**Phase 2（2-3 周）：实体消解 Level 1-2**
- entities 表 + relations 表
- LLM 整理时输出结构化实体
- 业务系统主键优先 + 强属性匹配
- `resolve_entity` 内部 API
- agent 可调的 `query_relations` tool

**Phase 3（按需）：实体消解 Level 3-4**
- 会话级 active entities 池（OpenClaw 侧）
- 跨会话实体融合（建议合并 + 可逆 merge log）
- embedding 相似度辅助

### Phase 1 关键设计决策（待用户确认）

1. **记忆隔离粒度**：user-level 共享 vs (user, agent) 各自独立？
   - 影响 schema 是否需要 `agent_id` 字段
   - 影响跨 agent 学习速度 vs 隐私边界

2. **业务系统集成范围**：记忆服务能直接访问哪些业务系统作为 ground truth？
   - CRM？DMS？订单系统？
   - 影响 Phase 2 实体消解的实现路径

3. **接入方约束**：是否所有接入方都基于 OpenClaw？还是要支持任意 Agent 框架？
   - 影响 SDK 抽象层的设计深度

---

## 当前 vs 推荐方案：能力增量分析

> 在决定推进自建前，先盘点 OpenClaw 现有的记忆能力，避免"重做已有的轮子"，并明确叠加方案带来的真实增量。

### 当前已有的记忆能力（盘点）

通过 `src/memory/`、`src/runtime/`、`src/evolution/`、`src/transcript/` 的代码盘点：

| 能力 | 现状 |
|---|---|
| 7 类记忆分层 | user / feedback / project / reference / procedure / fact / episode |
| 记忆索引 | `memory-index.ts` 维护 MEMORY.md，SHA-256 增量去重 |
| 跨源检索 | memory + episodes + tasks + transcripts 联合打分（词法 + source 权重 + recency + session boost） |
| 冲突管理 | `conflict-store.ts` 4 状态机（open / needs_user_confirmation / resolved / ignored） |
| Agent 工具 | `memory.index` / `memory.retrieve` / `memory.inspect` / `memory.remove` / `transcript.search` / `transcript.replay` / `session_search` |
| 会话持久化 | `transcript-plugin.ts` 全事件 jsonl + SQLite FTS5 索引 |
| 上下文装配 | `context-assembler.ts` 按预算裁剪（admin 4500 / memory 4500 / task 3000 / transcript 2500，max 18000） |
| 写入触发 | LLM evolution judge（`evolution/judge.ts`）+ `MemoryLearner.apply` 唯一入口 |
| 自动整理 | `memory-compactor.ts` 去重/合并/置信度衰减/episode→memory 压缩 |
| 维护调度 | `maintenance-scheduler` 心跳 + idle hook，跑 nightly/recurring jobs |
| 隔离粒度 | **单一 user_id 维度**，文件系统目录隔离 |
| 检索机制 | **纯词法**（token 命中 + 短语包含 + 中文 2-gram + 多因子加权），**无向量** |
| 调用形态 | OpenClaw 内部使用，**无对外服务接口** |

**结论**：当前是一个**单租户、词法检索、LLM-judge 写入的成熟记忆系统**。这意味着推荐方案不是"从零构建"，而是"在外面包一层 + 在里面加结构化层"。

### 推荐方案叠加后的真实增量

#### 增量 1：多租户 + 业务隔离 🔴 **从无到有**

| 维度 | 现状 | 叠加后 |
|---|---|---|
| 隔离粒度 | `user_id` 单维 | `(business_id, user_id, agent_id?)` 三层 |
| 隔离实现 | 文件系统目录 | DB 表级 + 应用层强校验 |
| 跨 agent | 无概念 | 多 agent 单机部署原生支持 |

**业务价值**：B2B 多租户场景从"不能上"变成"能上"。架构级跃迁。

#### 增量 2：向量检索 + 语义召回 🟡 **质变升级**

| 维度 | 现状 | 叠加后 |
|---|---|---|
| 检索机制 | 词法（token 命中 + 短语包含 + 中文 2-gram） | hybrid（词法 + 向量 + rerank） |
| 语义查询 | "客户投诉售后" 召回不到"用户对售后服务不满意" | 召回 |
| 跨语言/同义 | 召回率低 | 显著提升 |

**业务价值**：当前最明显的瓶颈是长尾查询召回率。向量检索直接解决。

#### 增量 3：结构化实体 + 关系图谱 🔴 **从无到有**

| 维度 | 现状 | 叠加后 |
|---|---|---|
| 实体表示 | 记忆是文本 | entities + relations 表 |
| 跨记忆关联 | 无 | `(subject, predicate, object)` 三元组 |
| agent 可调查询 | 单一 `memory.retrieve` | `query_relations` / `get_entity` / `find_path` |

**业务价值**：agentic search 的本质能力。从"找相似记忆"升级到"在记忆图谱上做关系推理"。

#### 增量 4：实体消解 🔴 **从无到有**

| 维度 | 现状 | 叠加后 |
|---|---|---|
| "张总" 和 "张建国" | 两条独立记忆 | 同一个 `customer:c_042` |
| 跨会话一致性 | 无 | 实体跨会话融合 |
| 业务系统集成 | 无 | CRM 主键作为 ground truth |

**业务价值**：当前记忆是碎片化文本，agent 看到"张总下单"和"张建国投诉"会当成两个人。叠加后是同一客户的完整画像。

#### 增量 5：会话级 active entities 🟡 **当前接近无**

| 维度 | 现状 | 叠加后 |
|---|---|---|
| 指代消解 | conversation-context 取最近 6 turn 文本，让 LLM 自己看 | 显式维护 active entities 池，传给 LLM |
| "他媳妇"这类 | 可能消解错或漏 | 准确锚定 |

**业务价值**：长对话指代消解准确率提升。

#### 增量 6：HTTP 服务化 + 接入方 SDK 🔴 **从无到有**

| 维度 | 现状 | 叠加后 |
|---|---|---|
| 调用形态 | 仅供 OpenClaw 内部，文件系统直读 | HTTP 接口，任意 Agent 框架可接入 |
| 接入方代码 | N/A | NPM 包 + 抽象类 + tool，install 即用 |

**业务价值**：当前记忆只服务 OpenClaw 自己；叠加后是通用记忆服务，跟 OpenClaw 解耦——这是 7 点方案的核心目的。

#### 增量 7：消息上报通路 🟡 **格式升级**

| 维度 | 现状 | 叠加后 |
|---|---|---|
| 持久化 | jsonl 文件 + FTS5 | 共享 PG 关系表 |
| 跨服务可见 | OpenClaw 本进程 | HTTP 接口对外暴露 |
| 用于纠错 | 本地 grep | 跨服务查询 |

### 不变的部分（推荐方案保留你已有的）

✅ 7 类记忆分层 → 直接搬到 entities/memories 表的 `category` 字段
✅ LLM evolution judge 决定写入 → 整理 agent 复用同样模式
✅ MEMORY.md 索引短路 → 检索快路径保留
✅ Conflict store 4 状态机 → 同样适用于实体冲突
✅ Auto-compaction → episode→memory 压缩策略不变
✅ Context budget assembly → 保留，作为 prompt 装配最后一层

### 改造矩阵：哪些是"叠加"，哪些是"重做"

**纯叠加（不动现有代码）**：
- 向量检索（在现有词法检索旁加一路）
- 实体/关系图谱表（新增表，不动 memory.json）
- HTTP 服务（新增接口层，内部调现有 MemoryRetriever）

**改造（动现有代码）**：
- workspace 隔离从单 user 加 business_id 维度（影响 `workspace-context.ts`）
- MemoryLearner 写入路径要走 HTTP 接口或本地双写
- transcript 上报从 jsonl 加一路写 PG

**完全新增**：
- entity resolution + 业务系统适配
- session active entities 池
- 接入 SDK + 抽象类

### Phase 收益节奏

| Phase | 增量 | 业务意义 |
|---|---|---|
| Phase 1 | 增量 1 + 2 + 6 + 7 | B2B 商业化临门一脚（多租户 + 向量 + 服务化） |
| Phase 1+2 | 上述 + 增量 3 + 4 | 从"会找文本"升级到"会推理"，agent 能力代差 |
| Phase 3 | 增量 5 + 高级实体融合 | 长尾质量优化 |

### 投资优先级建议

- **若近期目标是 B2B 商业化**：Phase 1 是最高 ROI，2-3 周拿到多租户 + 向量 + 服务化
- **若近期目标是 agent 能力差异化**：Phase 1+2 合做，agentic search 真正可用

---

## 后续重新评估 GBrain 的触发条件

满足以下任一条件，重新评估接入：

- GBrain 进入 v1.0 稳定版且公开承诺多租户支持
- 项目场景从 B2B 多租户转为 B2C 单用户
- 出现"必须用 GBrain 自动 entity link"的不可替代场景
- 团队需要利用 GBrain 的图谱能力做技术调研/学习

---

## 附录：本次讨论的演化

### 我的判断变化轨迹

| 节点 | 判断 | 修正原因 |
|---|---|---|
| 初次 | "实体链接不需要" | 用户提出 agentic search → 修正：需要，但来源不一样 |
| 初次 | "消息进 GBrain 是把对话写成 markdown" | 用户澄清：是借共享 PG 实例建独立表 → 重新评估为可行 |
| 初次 | "HTTP 包一层是 GBrain 内部加" | 用户澄清：是在 GBrain 外面自己包 → 重新评估为合理 |
| 初次 | "整理逻辑放 GBrain 不可行" | 用户澄清：整理在 OpenClaw 侧，GBrain 只录入 → 重新评估为合理 |

### 不变的核心判断

- GBrain single-tenant 架构与用户的多租户需求根本冲突
- GBrain 的 pg_trgm 实体识别不适合业务系统主键场景
- GBrain alpha 稳定性对生产 agent 是显著风险
- 7 点方案中无任何一条不可替代依赖 GBrain

---

## 相关资源

- GBrain 仓库：https://github.com/garrytan/gbrain
- OpenClaw 引擎/业务解耦完成报告：见 git log（3-A 至 4-H 系列）
- 引擎 INTENTS 常量定义：`src/agent/ports.ts`
- 当前会话存储路径：`workspace.sessions_dir`（资源已就绪，可直接复用为 messages 表的存储后端）

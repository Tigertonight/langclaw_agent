---
version: intent-router-draft
date: 2026-05-11
status: draft
author: Claude Code 协助起草
branch: codex/intent-router
---

# Intent Router 架构设计：Intent Router 与四类 Handler

## 1. 背景与目标

- **原架构**：「规则分类 + 规则选 skill + 规则抽参 + 兜底再交给 LLM」的混合架构，LLM 在大多数路径上是被动补丁。
- **痛点**：规则一旦命中就把 LLM 完全挡在外面（典型表现：`extractVehicleSeries` 把「汉EV」错配成「汉」），导致用户问法稍有偏差就路由错或抽参错。
- **目标**：把入口交给一个 LLM Intent Router，由它输出 `intent_code` / `execution_class` / `handler_type`，每个 code 的 manifest 是唯一权威，统一分发到受控执行或自主规划。

## 2. 现状问题诊断（5 个结构性问题）

| # | 问题 | 关键证据 |
|---|---|---|
| 1 | 本地规则分类器对关键词命中即给 ≥0.86 高置信度，OpenAI 路径基本不会被触发 | `src/llm/local-llm.js:44-86`、`src/llm/openai-llm.js:1153-1158`（`shouldTrustLocalRecognition` 在 confidence ≥0.82 时直接信本地） |
| 2 | Skill 选择是纯规则打分，LLM 看不到 skill 描述，意图与 skill 之间靠硬编码权重耦合 | `src/skills/selector.js:40-59`、`src/skills/runtime.js` |
| 3 | 参数抽取依赖硬编码字面量列表，新车型/新门店/新部门必须改代码 | `src/query/query-parser.js:202-210`（车系列表 `["汉","宋L","海豹","秦PLUS",...]` 用 `includes` 匹配，「汉EV」会匹配到「汉」） |
| 4 | `enforceSkillContracts` 在 LLM 出 plan 之后用正则静默改写 plan，作用域逻辑不可解释 | `src/agent/nodes.js:72-205` |
| 5 | PrimitiveRegistry 设计已存在但未在主路径调用；agentic loop 内还混着「dealer-evidence」等业务硬规则 | `src/runtime/agentic-loop.js`、`src/runtime/free-agent-loop.js` 仅在 fast-grounded 与 agentic 两条线之间二选一，未把"intent → handler"作为一等概念 |

## 3. 核心架构

### 3.1 流程图

```
            ┌──────────────────────────────────────────────────────┐
            │               用户消息 + 会话上下文                  │
            └───────────────────────┬──────────────────────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │  Intent Router    │   ← LLM 单次调用
                          │  (single LLM)     │     输出 JSON
                          └─────────┬─────────┘
                                    │  {intent_code, handler_type,
                                    │   params, confidence, reasoning}
                                    ▼
            ┌───────────────────────┬───────────────────────┐
            │                       │                       │
   handler_type =                handler_type =     handler_type =      handler_type =
     chitchat                    intent_query         workflow             agentic
        │                            │                   │                    │
        ▼                            ▼                   ▼                    ▼
  ChitchatHandler           IntentQueryHandler    WorkflowRunner          AgenticLoop
  （直接生成回答）         （code+params→tool      （现有，复用）         （开放规划，
                            一次执行→answer）                              可调 intent_query
                                                                             作为子工具）
                                    ▲                       ▲                    │
                                    └───────────────────────┴────────────────────┘
                                          intent_query 作为可调用工具暴露给 agentic
```

### 3.2 Handler 定位

| handler_type | 定位 | 何时进入 |
|---|---|---|
| `chitchat` | 不查数据、不查 KB，直接生成回答（问候、能力介绍、闲聊、追问澄清） | 明显寒暄 / 问能力 / 不需要任何外部信息 |
| `intent_query` | 一次性结构化查询：输入 = 已抽好的 params，输出 = answer + table | Router 高置信度地认出某个预定义查询 code |
| `knowledge_lookup` | 知识库检索：制度、流程、手册、标准问答 | Router 命中 `knowledge.policy_qa` |
| `workflow` | 多轮严格状态机，必须收齐 slots 再执行（如请假申请） | Router 识别出业务流程类 code |
| `agentic` | 开放规划循环，自由组合工具，可递归调用 intent_query | 复杂分析、跨域、低置信度兜底、`intent_code = "general"` |

> **why 这样切**：旧路径的痛点是"快路径"和"慢路径"混着写。Intent Router 把 4 类边界讲清楚——快的就一次执行不绕远路，慢的就老实进 agentic loop，不再让两者互相污染。

## 4. Router 详细设计

### 4.1 输入

```json
{
  "message": "查一下华东旗舰店汉EV库存最近一个月的库龄情况",
  "user_context": {
    "user_id": "u_001",
    "name": "张三",
    "department": "华东销售部",
    "role": "manager",
    "permissions": ["dealer:read", "..."]
  },
  "session_state": {
    "active_intent_code": null,
    "active_workflow_step": null,
    "last_task": { "intent_code": "...", "params_snapshot": {...} }
  }
}
```

### 4.2 输出 schema

```json
{
  "intent_code": "dealer.query.inventory",
  "handler_type": "intent_query",
  "params": {
    "vehicle_model": "汉EV",
    "store": "华东旗舰店",
    "time_range": "近一个月",
    "warning_level": null
  },
  "confidence": "high",
  "reasoning": "用户在问汽车库龄；提及了具体门店、车型和时间范围。"
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `intent_code` | string | 必填。来自 manifest 注册表；不认识时填 `"general"` |
| `handler_type` | enum | `chitchat` / `intent_query` / `workflow` / `agentic`；从 code 的 manifest 里取，Router 也输出一份做交叉校验 |
| `params` | object | 按 code 的 params schema 抽取；缺失字段写 `null`，**不要硬猜** |
| `confidence` | enum | `high` / `medium` / `low`，**不要数值**——降低 LLM 输出不稳定的几率 |
| `reasoning` | string | 一句话，给日志看的 |

### 4.3 兜底策略

| 情况 | 处理 |
|---|---|
| `confidence = low` | 强制改写 `handler_type = "agentic"`，`intent_code` 保留作为 hint |
| `intent_code = "general"` | 直接走 agentic |
| Router 输出的 code 在 manifest 里找不到 | fail closed，返回 router error |
| Router 输出的 `handler_type` 与 code manifest 不一致 | 以 manifest 为准，覆盖 Router 的输出，记日志 |
| `params` 缺关键字段且 code 标了 `required` | 进入 `agentic`（让它自己问用户或自己组合查询）；**不要**回到旧的 if-else 抽参 |

### 4.4 LLM 失败策略

当前实现采用 fail closed：Router LLM 不可用、输出无法解析、或返回未注册 intent_code 时，不回退旧业务路由。只有低风险 `system.smalltalk` 在无 API key 时有极小本地兜底。

这样牺牲少量可用性，换取企业数据场景下更强的可治理性和可审计性。

## 5. Intent Code 体系框架

### 5.1 命名规范

格式：`<domain>.<action>.<target>`

- `domain`：业务域，例如 `dealer` / `attendance` / `org` / `kb` / `system`
- `action`：动作类型，常见值 `query` / `submit` / `chat` / `analyze` / `general`
- `target`：被操作对象，例如 `inventory` / `leave_request` / `employee`

特例：`general`、`smalltalk` 等系统级 code 不强求三段式。

### 5.2 Manifest 字段

每个 intent_code 对应一份注册项，结构如下：

```json
{
  "intent_code": "dealer.query.inventory",
  "handler_type": "intent_query",
  "version": "1",
  "description": "查询经销商整车/在途/配额/库龄等库存类信息。",
  "params_schema": {
    "vehicle_model": { "type": "string", "required": false, "examples": ["汉EV", "宋L DM-i"] },
    "store":         { "type": "string", "required": false, "examples": ["华东旗舰店"] },
    "time_range":    { "type": "string", "required": false, "examples": ["近一个月", "Q2"] },
    "warning_level": { "type": "enum",   "values": ["关注","预警","紧急"] }
  },
  "examples": [
    "查一下华东旗舰店汉EV库存最近一个月的库龄情况",
    "宋L 现在还有多少配额"
  ],
  "confidence_threshold": "medium",
  "sub_tools_available": false,
  "tool_binding": {
    "tool_name": "query_business_data",
    "resource": "dealer_vehicles",
    "params_to_filters": "rules-or-llm-mapping"
  },
  "required_permissions": ["dealer:read"]
}
```

字段说明：

| 字段 | 用途 |
|---|---|
| `handler_type` | 决定走哪条 handler 路径（**唯一权威**） |
| `params_schema` | Router prompt 里要把这个 schema 喂给 LLM，让它知道抽哪些字段 |
| `examples` | Router few-shot 用 |
| `confidence_threshold` | Router 置信度 < 该阈值时降级到 agentic |
| `sub_tools_available` | 该 code 是否允许被 agentic 当子工具调用 |
| `tool_binding` | intent_query 类专用：直接绑定到一个 tool + resource，避免再走一遍 IR 编译 |
| `required_permissions` | 进入 handler 前做一次权限检查 |

### 5.3 三个示例 code（仅作格式示例，不是最终清单）

```
dealer.query.inventory     handler_type=intent_query
dealer.query.colleague     handler_type=intent_query
attendance.submit.leave    handler_type=workflow
```

> **why 不在本文档列全清单**：这部分需要和用户一起根据现有 9 个 skill 拉一遍，定下来再写到 `intent-codes.json`。

## 6. 四类 Handler 各自怎么跑

### 6.1 chitchat

- 输入：原始 message
- 行为：不查任何数据，直接由生成模型出答复（也可以是固定模板）
- 输出：answer
- 复用：现有 `createFastSmalltalkAnswer`（`src/llm/openai-llm.js:124`）逻辑

### 6.2 intent_query（PoC 重点）

执行步骤：

1. Router 已经给出 `intent_code` + `params`
2. 查 manifest 拿 `tool_binding`
3. 把 `params` 映射到 tool 的 filters/fields/sort（映射规则放在 manifest 或 handler 内的 small mapper，**不再写死在 query-parser.js**）
4. 调一次 tool（绝大多数情况下 1 次，少数 code 可能 2 次串行）
5. 用 LLM 把 raw rows → 自然语言 answer（沿用现有 `formatBusinessDataResult` 或新的精简模板）
6. 返回 answer + table artifact

> **why 这条路径独立出来**：旧路径里这种"已经知道怎么查"的问题被塞进了和 agentic 同一条 free-agent-loop，平均要走 2-3 个 LLM 调用；intent_query 目标是 **1 次 Router LLM + 1 次 tool + 1 次 answer LLM**，延迟和成本都可控。

### 6.3 workflow

- 直接复用 `WorkflowRunner`（`src/runtime/workflow-runner.js`）
- 适配层：在进入 workflow 前，先把 Router 的 `intent_code` 和 `params` 翻译成现有 scenario 期望的 `active_intent` + `slots`
- 已经在跑的 workflow 通过 `session.active_intent_code` 续跑，不让 Router 抢回去
- 与旧入口对比：唯一差异是入口从 `classifyIntentNode → scenarioRouter` 变成 `Router → workflow handler → scenarioRouter`

### 6.4 agentic

- 复用 `AgenticLoop`（`src/runtime/agentic-loop.js`）的循环骨架
- **关键改造**：把所有 `sub_tools_available = true` 的 intent_query code 注册成可被 agentic 调用的"虚拟工具"
  - 工具名：`call_intent.<intent_code>`
  - 工具参数 schema：等于该 code 的 `params_schema`
  - 工具实现：内部直接走 intent_query handler，再把结果作为 observation 返回给 agentic
- 目的：跨域复杂问题（"对比华东和华南库存压力"）由 agentic 拆解为多次子 intent_query，而不是再写一份 `planDealerMultiQuery`
- 旧的 `enforceSkillContracts` 不在主路径再用；其逻辑（如部门 scope）下沉到对应 intent_query 的 params mapper

## 7. PoC 范围：dealer-inventory

### 7.1 PoC 要新建/修改的文件（推测）

新建：

- `src/router/intent-router.js` — Router LLM 调用 + JSON 解析 + 兜底
- `src/router/intent-registry.js` — 加载 `data/intent-codes/*.json` manifest 注册表
- `src/router/router-prompt.js` — Router 的 system prompt 模板（含 examples 注入）
- `src/handlers/intent-query-handler.js` — intent_query 执行器
- `src/handlers/chitchat-handler.js` — 寒暄 handler 包装
- `data/intent-codes/dealer.query.inventory.json` — 第一个 manifest
- `src/eval/router-eval.js` — Router 准确率评估（intent_code + params 双轴）

修改：

- `src/agent/orchestrator.js` — 在最前面插入 Router；命中 intent_query/chitchat 时直接走新 handler，命中 workflow 走现有 runner，命中 agentic 走现有 free-agent-loop
- `src/runtime/agentic-loop.js` — 把 `sub_tools_available` 的 code 注册到 toolRegistry 视图
- `skills/dealer-inventory/manifest.json` — 加 `intent_codes: ["dealer.query.inventory"]`，标注 Intent Router 入口

### 7.2 PoC 验证标准（必须通过的用例）

| # | 输入 | 期望 |
|---|---|---|
| 1 | "查一下华东旗舰店**汉EV**最近一个月的库龄" | Router 输出 `vehicle_model="汉EV"`（不是「汉」），命中 intent_query，返回汉EV 行 |
| 2 | "宋L 还有多少配额" | Router 抽出 `vehicle_model="宋L"`，命中 intent_query，查 dealer_quotas |
| 3 | "华南标准店库存怎么样" | Router 抽出 `store="华南标准店"`，命中 intent_query |
| 4 | "你好" | handler_type = chitchat |
| 5 | "对比华东旗舰店和华南标准店哪家库存压力更大" | handler_type = agentic（confidence 不会太高，或 code 注册为 analyze 类） |
| 6 | "把这个 vehicle_model 改成 海豹" 紧跟用例 1 | 通过 session_state.last_task 做 continuation，沿用上一轮 intent_code + 合并 params |

### 7.3 PoC 不做的事

- 不重写 leave-request workflow
- 旧 `local-llm.js` 规则仅作为 legacy 保留，不再作为业务路由兜底
- 不接真实 LangGraph / OpenClaw 库
- 不把其他 8 个 skill 一次性迁完
- 不引入新的 LLM provider
- 不改前端展示协议

## 8. 现有 9 个 Skill 的重新归类（暂定）

| Skill | 暂定归类 | 说明 | 不确定性 |
|---|---|---|---|
| business-query | intent_query (拆) | 客户/订单/报表 各自拆为独立 code | ❓ 是否拆成 3 个 code（customer/order/sales_report）还是合并为一个带 target 参数的 code |
| dealer-inventory | intent_query | PoC 第一个迁的 | 无 |
| dealer-after-sales | intent_query (拆 2) | repair_orders 与 warranty_claims 各 1 个 code | 低 |
| dealer-finance | intent_query | 单 code `dealer.query.finance` | 无 |
| dealer-sales | intent_query (拆 2) | leads 和 sales_orders 各 1 个 code | 低 |
| dealer-analysis | agentic 专属 | 涉及多 resource 综合分析，本质就是 agentic | ❓ 是否还要保留一个 `dealer.analyze.report` code 用于显式触发 |
| knowledge-qa | intent_query | 单 code `kb.query.policy`，绑定 `retrieve_knowledge` | ❓ 长尾问题是否要降级到 agentic |
| leave-records | intent_query | `attendance.query.leave` | ❓ "团队范围 / 公司范围" 这种 scope 字段放进 params 还是放进权限层 |
| leave-request | workflow | 现有 strict_workflow，直接复用 | 无 |

## 9. 重构路径（灰度切换策略）

| 阶段 | 内容 | 退出标准 |
|---|---|---|
| **1. Router 接入** | 实现 Router + intent registry，并用日志观测 Router intent_code 与现有 intent_code 的映射准确率 | 现有 eval 全绿；日志中 Router intent_code 与现有 intent_code 的映射准确率 ≥85% |
| **2. dealer-inventory PoC** | 上文 §7 范围 | §7.2 的 6 个用例全过；新建的 router-eval 在 dealer-inventory 子集上 intent_code 准确率 ≥90%、params 准确率 ≥85% |
| **3. 扩展到其他 intent_query 类** | 按 §8 顺序迁 business-query、dealer-finance、dealer-sales、dealer-after-sales、knowledge-qa、leave-records | 全量 eval 不退化；router-eval 在所有迁完的 code 上准确率 ≥88% |
| **4. 整合 workflow & 废弃旧 intent 路径** | leave-request 从 Router 入口走；删除 `inferIntentCode` 的关键词分支，`local-llm.js` 仅保留为熔断兜底 | 一周生产日志中旧路径触发率 < 1%；Router 主路径稳定 |

## 10. 风险与未决问题

### 10.1 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | LLM JSON 输出不稳定（缺字段、字段类型错、附带 markdown 包裹） | 用 `response_format: json_schema`（OpenAI 支持）+ 出错重试 1 次 + 失败兜底到 local-llm |
| R2 | Router 准确率达不到 90% | shadow 模式先跑 1-2 周，针对错例补 examples、调阈值；准确率不达标不进入阶段 2 |
| R3 | agentic 调 intent_query 时上下文（user/permission/session）不易透传 | 把 `call_intent.*` 实现成"内部函数调用而非真 tool"，共享 orchestrator 上下文；不要让 LLM 自己去拼 user_id |
| R4 | 一次 Router LLM 调用增加首字延迟（约 +500-1500ms） | chitchat fast-path 仍由本地正则快速判出，不进 Router；其他场景延迟可接受 |
| R5 | Router 与 manifest 不一致漂移（code 改了 schema，Router prompt 没更新） | manifest 改动触发 prompt 重建；CI 检查 examples 中的字段是否仍在 schema 中 |

### 10.2 需用户拍板的未决问题

- ❓ **Q1**：`confidence` 用枚举（high/medium/low）还是数值（0-1）？（建议枚举，更稳）
- ❓ **Q2**：business-query 拆分粒度——拆 3 个 code 还是合并为一个带 `target` 参数的 code？
- ❓ **Q3**：dealer-analysis 是否需要一个显式的 `dealer.analyze.*` code？还是完全交给 agentic + general？
- ❓ **Q4**：`call_intent.<code>` 的工具命名是否对 LLM 友好？是否要改成更口语化的 `query_dealer_inventory` 这类名字？（影响 agentic 调用准确率）
- ❓ **Q5**：Router 是否要支持单条消息映射到多个 intent_code（"查库存顺便看下配额"）？当前建议只支持 1 个，多 intent 让 agentic 处理。

---

> 本文件为设计草案，未涉及具体代码改动。下一步：与用户对齐 §8 的归类与 §10.2 的 5 个问题，然后开始 §7 的 PoC 实施。

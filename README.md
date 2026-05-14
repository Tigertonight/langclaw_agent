# Enterprise Agent · 汽车经销垂类

面向汽车 4S 店内部使用的企业 Agent。围绕"店总 / 区域 / 销售顾问 / 售后顾问 / 财务"几类岗位，把零散的业务问题——线索漏斗、库存压力、订单毛利、维修工单、保修索赔、财务汇总——拢成一个会话入口。

技术上是 **workflow + tool-calling** 架构，不依赖 LangChain / OpenClaw，但对外接口稳定（LLM client / KnowledgeBase / Tool / Orchestrator），后续要迁也不难。

## 当前能做什么

- **Intent Router v2**：单次 LLM 调用判别 `{intent_code, handler_type, params}`，意图清单从 `data/intent-codes/*.json` 加载
- **三类 handler**：
  - `intent_query` — 一个意图 + 一组参数 → 一次工具执行
  - `chitchat` — 直接回答的小聊
  - `agentic` — 跨意图的 LLM tool-calling 循环（最多 7 步、单步 35s、整体 180s 超时）
- **三类工具（agentic 路径）**：
  - `intent.*` — 每个 intent_code 自动暴露成工具
  - `tool.*` — 标了 `expose_to_agentic` 的原子能力，目前主要是 `safe_compute`（沙箱里跑 JS 算精确指标）
  - `skill.*` — 注入式"写作/汇报包"，调用后把 `SKILL.md` + 模板 + 示例塞进上下文，下一步直接 answer
- **流式 UI**：`/` 自带聊天页。默认业务视角——顶部"处理中… X.Xs" 100ms 跳一次，每步出一对"动作量化 + 解读叙述"；右上角 Debug 开关切回完整 phase 列表
- **RBAC + 多人身份**：本地 mock + 企业微信（可选真实接入），按权限决定哪些工具可见
- **会话持久化**：文件存储，重启不丢上下文
- **OpenAI-compatible LLM**：默认接 MiniMax，也可换成任何 OpenAI 兼容端点

## 快速开始

```bash
# 自检 + 冒烟
npm run config:check
npm run smoke

# 启 HTTP 服务（含聊天页）
INTENT_ROUTER_V2=on npm run server
# 浏览器打开 http://localhost:3000

# CLI 调试
npm run chat -- sales_001 "汉EV 卖得还行但毛利好像不太行，看下原因"
```

接 MiniMax（或任何 OpenAI 兼容服务）：

```bash
cp .env.example .env
# 填入：
# LLM_BASE_URL=https://api.minimaxi.com/v1
# LLM_API_KEY=你的_key
# LLM_MODEL=MiniMax-M2.7
```

## 关键环境变量

| 变量 | 说明 |
|---|---|
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 默认 LLM（OpenAI 兼容） |
| `LLM_DECISION_*` / `LLM_ANSWER_*` / `LLM_STREAM_*` | 分阶段独立模型覆盖（路由判别 / 最终回答 / 流式） |
| `INTENT_ROUTER_V2=on` | 启用 v2 router；不开则走 v1 规则兜底 |
| `WECOM_MODE` | `real` 接企业微信通讯录，`mock`（默认）走本地 |
| `WECOM_CORP_ID` / `WECOM_CONTACT_SECRET` | 企业微信真实接入所需 |
| `TENCENT_DOCS_MODE` | `real` 接腾讯文档，`mock`（默认）走本地 |
| `AGENTIC_DEBUG=1` | agentic handler 多打调试日志 |
| `PORT` / `HOST` | 默认 3000 / 0.0.0.0 |

## 目录结构

```text
src/
  agent/        Orchestrator（run + runStream）+ session store
  router/       Intent Router v2（LLM 判别） + intent registry
  handlers/     intent-query / chitchat / agentic 三类 handler
  skills/       AgenticSkillView（注入式 skill 加载） + v1 workflow skill runtime
  tools/        ToolRegistry + 业务工具 + sandbox（safe_compute）
  runtime/      conversation-context / free-agent-loop / workflow-runner
  auth/         UserContextResolver + WeCom + RBAC
  rag/          LocalKnowledgeBase + 腾讯文档 source
  llm/          OpenAILLMClient + LocalLLMClient（规则兜底）
  server/       HTTP / SSE 入口 + 自带聊天页
  scenarios/    旧请假/工作流场景（兜底保留）
  eval/         所有自动化验证脚本

skills/agentic/
  summarize-alert/           告警摘要 skill 包（SKILL.md + template + examples）
  gross-margin-attribution/  毛利率归因 skill 包

data/
  dealer-*.json              门店/库存/线索/订单/维修/财务等 mock 业务数据
  intent-codes/*.json        v2 router 的意图字典（dealer.query.* / dealer.aggregate.* …）
  wecom-*.json               组织架构 mock
  users.json                 账户 + RBAC

docs/
  architecture.md                     长期架构
  architecture-v2-intent-router.md    v2 router 设计
  router-poc-cases-v2.md              router-poc 用例清单
  mockups/*.html                      agentic 流式 UI 设计 mockup
```

## HTTP 接口

```bash
# 单轮
curl -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id":"sales_001","message":"汉EV 卖得还行但毛利好像不太行，看下原因","debug":true}'

# 流式（SSE，浏览器聊天页用的就是这个）
curl -N -X POST http://127.0.0.1:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"user_id":"store_gm_001","message":"门店本月库存压力如何？"}'

# 用 wecom_userid 直接发
curl -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"wecom_userid":"sales_001","message":"差旅报销标准是什么？"}'
```

多轮在请求里带同一个 `session_id` 即可。

## 验证脚本

```bash
npm run config:check    # env / 集成自检
npm run smoke           # 通用冒烟
npm run arch:smoke      # 架构冒烟
npm run session:smoke   # session 持久化恢复
npm run eval            # 基础 eval 集
npm run eval:dealer     # 汽车经销冒烟
npm run eval:router     # v2 router POC（100 用例，含跨意图三类工具）
```

## Tool 元数据规范

业务能力包成 tool 注册到 `ToolRegistry`，除了 `name`/`description`/`schema`/`execute`，还要声明治理元数据：

```js
metadata: {
  required_permissions: ["sales:query"],
  risk_level: "read",                  // read / write
  requires_confirmation: false,
  expose_to_agentic: true,              // 是否允许 agentic 路径直接调用
  scenarios: ["dealer_alert"],
  steps: ["awaiting_confirmation"]
}
```

`ToolRegistry` 会按用户权限、当前 intent、scenario 步骤动态决定哪些工具可见。比如确认前不会暴露写操作的 tool。

## 占位 / 还没做

- `agentic-skills/compose-followup/` — 占位，未实现
- AgenticHandler 的 `propose_tool` 动作分支 — v3 dynamic planning hook，记录但不执行
- 腾讯文档真实接入 — Source 类已写，默认仍是 mock
- 请假 workflow — 仍可跑，但已不是主路径

## 接 MiniMax 之外的模型

LLM 客户端是 OpenAI 兼容的，把 `LLM_BASE_URL` / `LLM_MODEL` 指到对应服务即可。决策、最终回答可以分配不同的 key/model（用 `LLM_DECISION_*` / `LLM_ANSWER_*` 这组 env），方便给路由用便宜模型、给回答用贵模型。

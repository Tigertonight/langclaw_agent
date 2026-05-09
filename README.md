# Enterprise Agent MVP

一个面向企业内部问答的基础 Agent 项目。当前实现采用 **workflow + tool call** 架构，不依赖 LangChain/OpenClaw，但保留了清晰接口，后续可以平滑迁移。

## 能力

- 用户身份与 RBAC 权限控制
- `UserContextResolver` 身份解析接口，当前支持 local/mock 企业微信，后续可接真实企业微信通讯录
- Mock 企业数据接口工具
- 上下文感知 Tool Registry：按用户权限、intent、scenario step 渐进式披露工具
- 知识库切片、召回、重排、来源引用
- `DocumentSource` 文档源接口，当前支持本地 Markdown/mock 腾讯文档，后续可接真实腾讯文档
- Agent 编排流程：意图识别、工具规划、权限校验、工具执行、RAG、回答生成
- 多轮业务场景：请假申请 slot filling、确认、提交
- 会话状态：支持同一 `session_id` 下连续补全业务条件
- 文件持久化 session：重启后可继续多轮业务流程
- CLI 调试入口
- HTTP `/api/chat` 入口
- Eval 测试集与自动验证脚本
- OpenAI-compatible Chat Completions 适配层，可通过环境变量接 MiniMax 等真实模型

## 快速开始

```bash
npm run smoke
npm run arch:smoke
npm run session:smoke
npm run config:check
npm run eval
npm run chat -- sales_001 "帮我查一下星河科技最近订单状态"
npm run server
```

多轮请假 demo 可以用交互式 CLI：

```bash
npm run chat -- sales_001
```

然后依次输入：

```text
我明天想请假
年假，请到下午6点，因为家里有事
确认
```

如果要接 MiniMax，把 `.env.example` 复制为 `.env` 并填写：

```bash
LLM_BASE_URL=https://api.minimaxi.com/v1
LLM_API_KEY=你的_minimax_key
LLM_MODEL=MiniMax-M2.7
```

当前真实模型主要用于最终回答生成；意图识别和工具规划仍保留本地确定性规则，方便 eval 稳定。后续可以把这两个节点也切到模型 JSON 输出。

当前仓库已进入第一阶段架构重构：

- 主链路开始从 `intent-first` 过渡到 `skill-first`
- 新增 `SkillRuntime` 作为统一技能选择层
- 新增 `PrimitiveRegistry` 作为 `query / retrieve / act / artifact` 兼容层
- 现有 workflow 场景继续保留，作为严格受控的 enterprise skill
- 新增私有 skill registry 第一阶段能力：本地目录安装、manifest 解析、启停与版本管理、enterprise runtime 权限绑定

## Private Skill Registry v1

当前已支持第一阶段私有 skill 注册：

- 从本地目录安装 skill
- `manifest.json` + `SKILL.md` 双文件模式
- `enabled` / `version` 管理
- skill 级 `required_permissions` 绑定到 enterprise runtime

相关目录：

```text
skills/                       内置 skills
workspace/skills/installed/  本地安装后的 skills
workspace/skills/registry.json registry 状态
```

HTTP 管理接口：

```bash
GET  /api/skills
POST /api/skills/install
POST /api/skills/:id/enabled
```

真实集成默认关闭。要接企业微信通讯录：

```bash
WECOM_MODE=real
WECOM_CORP_ID=你的企业ID
WECOM_CONTACT_SECRET=通讯录secret
```

要接腾讯文档，当前通过可配置内容接口接入：

```bash
TENCENT_DOCS_MODE=real
TENCENT_DOCS_BASE_URL=腾讯文档开放平台API域名
TENCENT_DOCS_ACCESS_TOKEN=访问token
TENCENT_DOCS_DOC_IDS=doc_id_1,doc_id_2
TENCENT_DOCS_CONTENT_ENDPOINT_TEMPLATE=/具体读取内容接口/{docId}
```

配置是否齐全可运行：

```bash
npm run config:check
```

HTTP 请求：

```bash
curl -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id":"sales_001","message":"帮我查一下星河科技最近订单状态","debug":true}'
```

多轮 HTTP 调用需要复用同一个 `session_id`：

```bash
curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"sales_001","session_id":"demo_leave_001","message":"我明天想请假","debug":true}'

curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"sales_001","session_id":"demo_leave_001","message":"年假，请到下午6点，因为家里有事","debug":true}'

curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"sales_001","session_id":"demo_leave_001","message":"确认","debug":true}'
```

## 推荐目录

```text
src/agent       Agent workflow 和回答生成
src/auth        用户上下文与权限
src/scenarios   多轮业务场景
src/tools       企业数据工具
src/rag         知识库索引、召回、重排
src/llm         LLM 抽象与实现
src/server      HTTP API
src/eval        自动化测试
data            mock 企业数据
docs/knowledge  知识库文档
docs/architecture.md 长期架构与 LangGraph 迁移映射
```

## 身份与文档源

Agent 不直接依赖企业微信或腾讯文档，而是通过稳定接口接入：

```text
企业微信 / 本地 mock → UserContextResolver → UserContext → Agent
腾讯文档 / Markdown → DocumentSource → KnowledgeBase → RAG
```

当前 HTTP demo 可以传 `wecom_userid`：

```bash
curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"wecom_userid":"sales_001","message":"差旅报销标准是什么？","debug":true}'
```

## Tool 规范

业务 API、CLI、SDK 都应该先包装成受控 tool，再注册到 `ToolRegistry`。每个 tool 除了 `name`、`description`、`schema`、`execute`，还需要声明企业治理元数据：

```js
metadata: {
  required_permissions: ["leave:submit"],
  risk_level: "write",
  requires_confirmation: true,
  scenarios: ["leave_request"],
  steps: ["awaiting_confirmation"]
}
```

当前 registry 会根据用户权限、intent、scenario 和 step 动态返回可用工具。比如请假信息收集阶段不会暴露 `submit_leave_request`，只有用户确认后才允许提交。

## 后续迁移

当前核心接口在 `src/agent/ports.js`：

- `LLMClient`
- `KnowledgeBase`
- `Tool`
- `AgentOrchestrator`

迁移 LangGraph 时，可以把 `classifyIntent`、`retrieveDocs`、`planToolCalls`、`permissionGuard`、`executeTools`、`generateAnswer` 分别变成 graph node。`src/scenarios/leave-request.js` 这类场景可以直接迁成 subgraph，当前 `session.state` 就是未来的 graph state。

接 OpenClaw 时，建议只把 OpenClaw 作为外部执行通道或入口通道，不要替代当前权限和审计核心。

# 多 Domain 隔离规划

目标：让同一个 Agent Runtime 可以承载多个业务域，但用户在某个业务场景中工作时，路由、数据、工具、上下文、OpenUI 和推荐命令都默认只服务当前场景。跨域能力只能在显式允许时发生。

## 当前判断

项目已经具备较好的 DomainPack 注册隔离：

- 各业务域通过 `src/domains/<domain>/domain-pack.ts` 注册资源、工具、权限、路由规则、OpenUI surface 和评测。
- 资源 id 已基本按域前缀隔离，例如 `dealer_*`、`cloud_*`。
- 前端已有“经销商 / 云商品”场景切换，且本地会话带 `domainId`。
- 云商品剧本验收已经发现并修复过一次真实混淆：云客户续约跟进问题被经销商线索规则抢走。

但还缺少“端到端硬边界”：

- 前端切换的 `domainId` 没有随聊天请求传给后端。
- 后端路由没有 `selected_domain` 约束，仍可能由关键词或 LLM 误判到另一个业务域。
- 会话上下文只按 `session_id` 保存，缺少后端可验证的 domain 归属。
- 推荐命令主要按用户角色取，不是按 `domain + role` 取。
- OpenUI surface 是全局尝试匹配，需要更强的 domain gating。
- Eval 已有云商品/经销商各自用例，但缺少专门的跨域隔离回归。

## 隔离分层

### 1. 前端场景隔离

前端场景切换应该产生一个明确的 `selected_domain`，随每次聊天、推荐命令、命令列表请求一起发送。

建议：

- 聊天请求增加 `domain_id: currentDomainId`。
- 推荐命令请求增加 `domain_id`，后端按 `domain + role` 过滤。
- 会话 key 从 `userId + sessionId` 升级为 `domainId + userId + sessionId`。
- 切换 domain 时不复用上一域输入草稿、推荐命令和上下文提示。

验收：

- 云商品 tab 下连续问“客户跟进/合同/毛利/库存”等歧义词，不出现经销商实体。
- 经销商 tab 下问“客户跟进/库存/毛利”，不出现云商品实体。

### 2. 路由隔离

路由应该支持三种模式：

| 模式 | 适用场景 | 行为 |
| --- | --- | --- |
| `strict` | 用户明确选中业务域 | 只允许当前 domain 的 intent，低置信度转当前域 agentic fallback |
| `soft` | 默认多业务首页 | 当前 domain 加权优先，但允许强证据跨域 |
| `cross_domain` | 用户明确要求跨域对比 | 允许多个 domain 参与，但答案必须标注来源域 |

第一阶段建议默认使用 `strict`。

路由实现建议：

- `RouteRequest` 增加 `selected_domain?: string`。
- `IntentRouter.route()` 在 deterministic 和 LLM 后增加 domain gate：
  - 如果返回 intent 不属于 selected domain，且不是 `system.*` / `general`，则降级到 selected domain 的 agentic intent 或返回场景不匹配提示。
  - 如果用户消息强烈命中另一个 domain，应回复“当前是云商品场景，是否切换到经销商场景？”而不是直接执行。
- LLM router prompt 注入当前 domain 的 allowed intent 列表，避免模型自由选择其他域。

验收：

- `selected_domain=cloud_commodity` 时，`dealer.*` intent 不得执行。
- `selected_domain=dealer` 时，`cloud.*` intent 不得执行。
- `general` 只能作为当前域 agentic fallback，不应绕过权限访问其他域工具。

### 3. 工具与权限隔离

工具层要做到“路由错了也不能越权”。

建议：

- 每个工具声明 `domain_id` 或从 tool name/DomainPack 注册关系反查 domain。
- `ToolRegistry.execute()` 增加 domain policy：
  - 当前请求有 `selected_domain` 时，只允许执行同域工具和白名单通用工具。
  - 写入/草稿/审批工具继续要求权限和 confirmation。
- 通用工具 `query_business_data` 必须要求传入资源 id，资源 id 再反查 domain；不允许查询当前 domain 外资源。
- 用户权限保留现有 `cloud:*`、`dealer:*`，并增加 `domain:<id>:access` 作为清晰的顶层开关。

验收：

- 云商品用户即便问“查库存线索”，也不能执行 `dealer.query_*`。
- 经销商用户即便问“查云账单”，也不能执行 `cloud_*` 资源。

### 4. 数据隔离

数据隔离分三层：

- 资源命名隔离：继续使用 `cloud_*`、`dealer_*`。
- 资源注册隔离：ResourceConfig 必须带 `domain` 或由 DomainPack 自动补齐。
- 行级权限隔离：客户、门店、合同、账单等继续走用户 scope 字段。

建议补强：

- 在 ResourceRegistry 层记录 `resource_id -> domain_id`。
- `getResourceDataPath()`、`query_business_data`、OpenUI evidence 都携带 domain 信息。
- Debug 和证据来源只展示中文业务名，不展示表名。

验收：

- 任意工具结果中不得混入另一个 domain 的 resource。
- Citation/source refs 只展示当前 domain 的中文来源。

### 5. 会话与记忆隔离

场景切换后，上一个 domain 的 recent messages / recent routes 不应影响当前问题。

建议：

- `session.domain_id` 后端持久化。
- `recent_messages`、`recent_routes` 按 domain 分桶。
- 如果同一个 `session_id` 被不同 domain 请求复用，后端拒绝或创建新 session。
- 长期记忆如果启用，应按 `(business_id, domain_id, user_id)` 隔离。

验收：

- 先在经销商场景连续问库存，再切到云商品问“风险怎么样”，不能引用车辆库存。
- 先在云商品场景问 ECS，再切到经销商问“交付延期”，不能引用 GPU 容量。

### 6. OpenUI 隔离

OpenUI 展示应先判断 domain，再选择 surface。

建议：

- OpenUI envelope 增加 `domain_id`。
- Surface plugin `matches()` 必须同时匹配 domain 和数据结构。
- 前端 renderer 对未知 domain/component 只在当前域内降级，不跨域寻找相似组件。
- CitationDisclosure 使用 domain 内来源标签。

验收：

- 云商品回答不渲染经销商库存/车辆组件。
- 经销商回答不渲染云商品 GMV/容量/发布流程组件。

### 7. 推荐命令与演示剧本隔离

推荐命令是售卖演示入口，必须强隔离。

建议：

- `data/recommended-commands.json` 从 `role -> commands` 演进为 `domain -> role -> commands`。
- API `/api/recommended-commands` 按 `domain_id + user.role` 返回。
- 剧本入口按 domain 分组，云商品剧本只出现在云商品 tab。

验收：

- 云商品 tab 不出现“库存、试驾、门店”等推荐。
- 经销商 tab 不出现“Seedance、Agent Plan、ECS GPU”等推荐。

## 实施阶段

### P0：最小硬隔离

- 前端聊天请求携带 `domain_id`。
- 后端 route request 接收 `selected_domain`。
- 路由结果做 domain gate。
- 推荐命令 API 增加 domain 过滤。
- 新增 `eval:domain-isolation`，覆盖云商品/经销商歧义词。

这是最优先，因为它直接解决用户可见混淆。

### P1：工具和数据硬边界

- ToolRegistry 增加 domain policy。
- ResourceRegistry 提供 `resource -> domain` 反查。
- `query_business_data` 强制当前域资源过滤。
- OpenUI envelope 增加 domain_id。

### P2：会话和记忆隔离

- 后端 session 保存 `domain_id`。
- recent messages/routes 按 domain 分桶。
- 跨 domain 复用 session 时强制切新会话。
- 长期记忆按 `(business_id, domain_id, user_id)` 隔离。

### P3：跨域协作白名单

只在用户明确要求时开启，例如“比较经销商业务和云商品业务的经营风险”。跨域回答必须：

- 标注每条数据的来源域。
- 不混用不同域的指标口径。
- 不把一个域的客户/合同/账单暴露给另一个域用户。

## 第一批隔离评测建议

云商品场景：

1. `selected_domain=cloud_commodity`：`我负责的云客户里，本周最该跟进哪三个机会？`
2. `selected_domain=cloud_commodity`：`客户合同和账单有什么争议，谁负责？`
3. `selected_domain=cloud_commodity`：`当前毛利和库存风险怎么样？`
4. `selected_domain=cloud_commodity`：`帮我看销售漏斗和本月 GMV。`

经销商场景：

1. `selected_domain=dealer`：`我负责的客户里，本周最该跟进哪三个线索？`
2. `selected_domain=dealer`：`库存风险和承诺交期怎么样？`
3. `selected_domain=dealer`：`本月订单毛利和开票状态怎么样？`
4. `selected_domain=dealer`：`老板问经营风险，给我晨会版。`

预期：

- 每条问题只允许命中当前 domain intent 或当前 domain agentic fallback。
- 回答和 OpenUI 不出现另一个 domain 的实体、字段、来源或组件。
- 如果用户显式问另一个 domain，回复切换场景建议，不直接执行。


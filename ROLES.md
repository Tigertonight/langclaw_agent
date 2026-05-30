# ROLES · 角色与权限模型

> 解释这个 Agent 的"谁能看到什么、能做什么"。读这一份就够，不用翻代码。

## 总览

```
data/users.json          每个账户：id + role + permissions + 数据范围
       │
       ▼
auth-service             鉴权 + 解析 user_context
       │
       ▼
intent-router / handlers 根据 user_context 决定该走哪个意图、该过滤哪些数据
       │
       ▼
tool-catalog / a2ui      根据 permissions 决定哪些工具 / 卡片可见
```

---

## 角色清单（与 `data/users.json` 对齐）

| role 字段 | 中文岗位 | 默认账号示例 | 主要场景 |
|---|---|---|---|
| `store_general_manager` | 店总 / 总经理 | `store_gm_001` 顾明远 | 全店看板、跨部门协调、日报汇总 |
| `sales_manager` | 销售经理 | `sales_manager_001` 周景行 | 团队业绩、组员跟进、培训 |
| `sales` | 销售顾问 | `sales_001` 林悦 / `sales_002` 周辰 | 个人客户跟进、成交、留资 |
| `manager` | 部门管理（销售方向） | `manager_001` 沈砚 | 销售经理之外的部门主管，权限近似 sales_manager |
| `finance_specialist` | 财务专员 | `finance_001` 唐若溪 | 营收 / 结算 / 费用 |
| `hr` | HR | `hr_001` 许宁 | 制度、考勤、招聘 |
| `retail_operator` | 零售运营 | `retail_user_001` 零售测试员 | 零售域 demo |

> ⚠️ **命名不一致提示**：`data/users.json` 的销售岗位 role 是 `sales`，而 `data/recommended-commands.json` 用的 key 是 `sales_consultant`。结果是销售顾问目前**回落 `_default`** 推荐命令。如果要给销售顾问定制 chips，把 `recommended-commands.json` 里的 key 从 `sales_consultant` 改成 `sales`，或在 `users.json` 增加 `role` 别名映射。详见 [COMMANDS.md §角色映射](COMMANDS.md#角色映射当前一致性问题)。
> 同样地，`recommended-commands.json` 还有 `warehouse_specialist` 但 `users.json` 没有这个角色，仓管目前没人有账号 → 不会被使用。

---

## 权限模型

### 权限是字符串 token

`users.json` 每个账户带一个 `permissions: string[]`，格式 `<domain>:<verb>`：

| 权限 | 含义 |
|---|---|
| `customer:read` | 读取客户档案 / 跟进记录 |
| `order:read` | 读取订单 / 成交 |
| `sales_report:read` | 读取销售报表（含他人数据） |
| `finance:read` | 读取财务数据 |
| `policy:read` | 读取制度 / 知识库 |
| `hr_policy:read` | 读取 HR 专项制度 |
| `retail:read` | 读取零售域数据 |
| `org:read` | 读取组织架构 |
| `leave:submit` | 发起请假 / 工单 |

未来可加 `inventory:read` / `*:write` 等，命名遵循 `domain:verb` 即可。

### 权限怎么生效

1. **意图过滤**（`/api/commands`、`/api/recommended-commands`）  
   每个 intent 在 `data/intent-codes/*.json` 声明 `required_permissions`。用户没有就直接看不到对应 slash 命令，**前端命令面板和 chips 都会过滤掉**。

2. **工具过滤**（`/api/tools/catalog`）  
   每个工具的 `metadata.required_permissions` 决定能否被该用户看到 / 调用。`ToolCatalog.build()` 返回三档：
   - `allowed` — 直接可调
   - `ask` — 需用户 / Agent 确认
   - `deny` — 不可调，目录里也不暴露

3. **数据行级过滤**（在 handler 内）  
   - 销售（`role: sales`）只能看 `accessible_customer_ids` 里的客户
   - 财务 / 店总走 `default_store` 限定门店
   - manager 通常 = sales_manager 行为，看部门内组员数据

### 角色 → 权限 当前默认配比

```
store_general_manager : customer:read, order:read, sales_report:read, finance:read,
                        policy:read, leave:submit, org:read
sales_manager / manager : customer:read, order:read, sales_report:read,
                          policy:read, leave:submit, org:read
sales                 : customer:read, order:read, policy:read, leave:submit, org:read
finance_specialist    : finance:read, order:read, policy:read, leave:submit, org:read
hr                    : hr_policy:read, policy:read, leave:submit, org:read
retail_operator       : retail:read, policy:read, org:read
```

权限不是按角色硬编码，是写在每个用户记录里。**改权限直接改 users.json，热重载用 `POST /api/admin/auth/reload`**（见 [API.md](API.md#post-apiadminauthreload)）。

---

## 数据可见范围（行级）

| role | 可见客户 | 可见门店 | 可见报表 |
|---|---|---|---|
| store_general_manager | 全店 | 自己的门店 | 全店 + 团队 |
| sales_manager / manager | 团队成员名下 | 自己的门店 | 团队 |
| sales | `accessible_customer_ids` 列出的 | — | 自己的 |
| finance_specialist | — | 全店或所属门店 | 财务报表 |
| hr | — | — | HR 专项 |
| retail_operator | retail demo 数据 | — | retail demo |

实现层：handler 在拉数据前会用 `userContext.accessible_customer_ids` 做 `WHERE customer_id IN (...)` 等价过滤。详见 `src/handlers/intent-query/*.ts`。

---

## 命名约定与改造建议

要新增一个角色，做这几件事：

1. `data/users.json` 加账号，写 `role` + `permissions`
2. `data/recommended-commands.json` 加同名 key + chips
3. 如果有专属 intent，给 `data/intent-codes/*.json` 写 `required_permissions`
4. 工具有限定，给 `defineTool({ metadata.required_permissions: [...] })`
5. **跑** `npm run config:check` 验配置一致性

要新增一个权限，做这几件事：

1. 在受影响的 intent / tool 的 `required_permissions` 加上
2. 在 `users.json` 给应当拥有的用户补上
3. `npm run config:check`

---

## 鉴权链路（开发 / 生产差异）

| 环境 | 鉴权方式 | 风险 |
|---|---|---|
| 开发 (`A2UI_AUTH_DISABLED=1`) | 任意 `X-User-Id` 都能用 | 仅本地，外网必关 |
| 测试 / UAT | `X-User-Id` + 内网网段 | 反代加 IP 白名单 |
| 生产 | `Authorization: Bearer <token>` 正式签发 | 配合企业 SSO / 短期 token |

`POST /api/chat/stream` 不计 user-quota（按 stream 并发上限计），其余 `/api/*` 都过 `guardRequest()`。

---

## 测试 & 验证

```bash
# 鉴权回归
npm run handlers:auth          # /api/handlers 鉴权矩阵
npm run commands:api           # /api/commands 角色过滤
npm run eval:tool-catalog      # ToolCatalog 权限过滤
npm run config:check           # 配置一致性自检（角色↔权限↔intent↔tool）
```

每次改 `users.json` / `tool-policies.json` / `intent-codes/*.json` 后，至少跑一次 `config:check`。

---

## 相关文档

- [API.md](API.md) — 用户上下文 / 权限相关接口
- [COMMANDS.md](COMMANDS.md) — slash 命令字典 + 角色推荐
- [DEPLOY.md §安全清单](DEPLOY.md#安全清单上线前过一遍) — 上线前的鉴权检查

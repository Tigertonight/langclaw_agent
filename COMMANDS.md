# COMMANDS · 业务命令字典

> Slash 命令是用户进入业务能力的最快入口。本文件给前端、销售培训、客户演示用。
> 字典数据源：`data/recommended-commands.json`（chips/landing）+ `data/intent-codes/*.json`（命令 ↔ intent 绑定）。

---

## 命令两条线

```
用户输入                     来源                          作用
───────                     ──────                        ────
"/今日新线索"  ──────────► CommandRegistry              触发 intent
                            (intentRouter.commands)       走 handler
"今日新线索"   ──────────► IntentRouter LLM 判别         若匹配同样 intent
                            (语义匹配，慢但灵活)          走同样 handler
```

前端上的 chips / landing cards 只是把第一条线的命令做成可点击 UI，本质上都是把 `/<command>` 注入输入框、回车等于发送。

---

## 角色推荐命令（landing 卡片 + composer chips）

每个角色看到 4 条推荐。Server 在 `GET /api/recommended-commands` 按 `user.role` 选取。

### `_default`（角色未匹配时回落）

| 命令 | 价值引导 |
|---|---|
| `/今日新线索` | 看今天新进的客户线索、来源与跟进优先级 |
| `/待跟进客户` | 罗列今天必须联系的客户与上次沟通要点 |
| `/门店业绩` | 今日成交、试驾、留资三项指标对比昨日 |
| `/写日报` | 按你今天的动作自动起草一份日报草稿 |

### `store_general_manager` — 店总

| 命令 | 价值引导 |
|---|---|
| `/门店业绩` | 全店今日成交/留资/试驾，含同环比与异常预警 |
| `/今日新线索` | 今天新进线索量、来源结构与未分配数量 |
| `/团队考勤` | 今日出勤、迟到与请假名单一目了然 |
| `/写日报` | 汇总门店当日关键数据生成管理日报 |

### `sales_manager` — 销售经理

| 命令 | 价值引导 |
|---|---|
| `/今日新线索` | 今天进店与网电线索分布，待分配数量 |
| `/待跟进客户` | 团队成员今天必须跟进的客户清单 |
| `/团队业绩` | 组员当月达成率排行与缺口分析 |
| `/写日报` | 团队当日核心进展自动汇总成日报 |

### `sales_consultant` — 销售顾问 ⚠️ 当前未生效

| 命令 | 价值引导 |
|---|---|
| `/待跟进客户` | 我今天该联系谁、上次聊了什么、下一步是什么 |
| `/今日新线索` | 今天分到我手上的新客户与基础画像 |
| `/我的业绩` | 本月成交、留资、跟进达标率与排名 |
| `/写日报` | 把今天接待与跟进自动整理成日报草稿 |

### `finance_specialist` — 财务专员

| 命令 | 价值引导 |
|---|---|
| `/门店营收` | 整车、保险、金融三类营收当月累计与缺口 |
| `/结算明细` | 今日待结算订单、金额与缺单提醒 |
| `/费用统计` | 本月各类费用结构与同比变化 |

### `warehouse_specialist` — 仓库专员 ⚠️ 当前 users.json 无此角色

| 命令 | 价值引导 |
|---|---|
| `/库存盘点` | 在库车型/配件数量、滞销与紧缺标记 |
| `/今日入库` | 今天入库车辆与配件清单及对应单据 |
| `/今日出库` | 今天出库流向、提车人与待签收件 |

---

## 角色映射（当前一致性问题）

`recommended-commands.json` 的 key 必须与 `users.json` 的 `role` 字段**完全一致**才会命中。当前不一致项：

| recommended-commands key | users.json 中是否存在 | 现状 |
|---|---|---|
| `store_general_manager` | ✅ | 命中 |
| `sales_manager` | ✅ | 命中 |
| `finance_specialist` | ✅ | 命中 |
| `sales_consultant` | ❌ users.json 是 `sales` | 销售顾问回落 `_default` |
| `warehouse_specialist` | ❌ users.json 没有 | 不会被使用（但占位） |

**修复方式**（任选其一）：

A. 改数据让命名对齐 `users.json`：
```bash
# data/recommended-commands.json
"sales_consultant" → "sales"
```

B. 在 `users.json` 新增 `sales_consultant` 角色，或在 auth-service 加角色别名映射。

C. 维持现状（销售顾问的 chips 走 `_default`，店总和销售经理是定制的），下一次产品迭代统一处理。

> 推荐方案 A，改 1 行数据，立即生效。

---

## 命令 → Intent 绑定

每个命令在 `CommandRegistry` 注册时声明 `intentCode`。当用户敲 `/今日新线索` 或者点 chip：

1. CommandRegistry 命中命令
2. IntentRouter 把这次请求标记为 `intent_code`（跳过 LLM 判别）
3. 找到该 intent 绑定的 handler
4. Handler 走业务查询 / 调工具 / 渲染 A2UI 卡片

查看绑定关系：`GET /api/handlers`（admin 接口）。

---

## 怎么加新命令

**最小步骤**（5 分钟）：

1. **决定意图**：是否复用已有 intent？没有就在 `data/intent-codes/<domain>.json` 加一条：
   ```json
   {
     "intent_code": "warehouse.stock.summary",
     "handler_type": "intent_query",
     "description": "查询库存汇总",
     "required_permissions": ["inventory:read"]
   }
   ```

2. **注册命令**：在 `src/router/command-registry.ts`（或对应 domainPack）加：
   ```ts
   commands.register({
     id: "stock_summary",
     intentCode: "warehouse.stock.summary",
     title: "库存盘点",
     triggers: ["/库存盘点", "/在库车多少"]
   });
   ```

3. **配置推荐 chip**（可选）：在 `data/recommended-commands.json` 对应角色加：
   ```json
   { "id": "stock", "label": "库存盘点", "command": "/库存盘点",
     "hint": "在库车型/配件数量、滞销与紧缺标记" }
   ```

4. **写 handler / 工具**：handler 调对应的 `dealer.*` 或 `warehouse.*` 工具拉数据，组装回答。

5. **回归**：
   ```bash
   npm run config:check
   npm run commands:api
   npm run eval:tool-catalog
   ```

---

## 命令命名约定

- 命令字串以 `/` 开头，**用中文短语**（用户能直接念出来）
- `id` 用英文 snake_case，作为程序键（不直接给用户看）
- `triggers` 可以多个，覆盖同义说法（`/团队业绩`、`/组员排行`）
- `label` 不超过 6 个汉字（chips 容器宽度限制）
- `hint` 一句话讲价值（< 30 字），landing 卡片副标题用

---

## 用户面 vs 运维面

| 接口 | 面向 | 鉴权 | 是否过滤 |
|---|---|---|---|
| `GET /api/commands` | 用户（命令面板） | 必须 user_id | ✅ 按 permissions 过滤 |
| `GET /api/recommended-commands` | 用户（chips/cards） | 必须 user_id | 按 role 选取（不再过滤权限）|
| `GET /api/handlers` | 运维（debug） | admin | ❌ 全量返回 |

---

## 相关文档

- [API.md](API.md) — `/api/commands` / `/api/recommended-commands` 接口契约
- [ROLES.md](ROLES.md) — 角色和权限模型
- [CHANGELOG.md](CHANGELOG.md) — 命令变更历史

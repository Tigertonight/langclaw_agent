---
title: Intent Router v2 PoC 实施报告
branch: codex/intent-router-v1
date: 2026-05-11
status: PoC 已落地，待人工跑通验证
---

# 概述

按 `docs/architecture-v2-intent-router.md` §7 的 PoC 范围（dealer-inventory + chitchat + general 兜底）落地。
默认通过 `INTENT_ROUTER_V2=on` 环境变量启用，关闭时所有路径与 v1 完全一致。

# 文件清单

新增：

| 文件 | 行数 |
|---|---|
| data/intent-codes/dealer.query.inventory.json | 25 |
| data/intent-codes/system.smalltalk.json | 17 |
| data/intent-codes/general.json | 15 |
| src/router/intent-registry.js | 67 |
| src/router/router-prompt.js | 56 |
| src/router/intent-router.js | 254 |
| src/handlers/intent-query-handler.js | 155 |
| src/handlers/chitchat-handler.js | 45 |
| src/eval/router-poc.js | 127 |
| docs/poc-router-report.md | 本文件 |

修改：

| 文件 | 变更 |
|---|---|
| src/agent/orchestrator.js | 构造函数新增 intentRouter / intentQueryHandler / chitchatHandler；`run()` 顶部插入 v2 分发；新增 `runIntentQuery` 与 `runChitchat` 方法 |
| src/app.js | 装配 IntentRegistry / IntentRouter / IntentQueryHandler / ChitchatHandler 并注入 orchestrator |
| package.json | 新增 `eval:router` 脚本 |

# 关键设计决策（已落地）

1. `confidence` 全程枚举 `high|medium|low`，与 design §4.2 / §10.2 Q1 对齐。
2. PoC 范围只 3 个 intent_code：`dealer.query.inventory`、`system.smalltalk`、`general`。
3. Manifest 是 `handler_type` 的唯一权威——Router 输出仅作 hint，分发前用 manifest 覆盖一次。
4. `confidence=low` 强制改写为 `agentic`（chitchat 例外，因为 chitchat 本身就是低风险）。
5. Router 兜底链：LLM JSON → local-llm.recognizeIntent（不删 keyword 规则）→ general/agentic。
6. `IntentQueryHandler` 不再调 `query-parser.js`，参数直接经 manifest 映射成 `query_business_data` 的 `filters`。
7. `vehicle_model` 用 `contains` op 直接命中 `model` 字段——不会再像 v1 一样把「汉EV」错配成「汉」。
8. `store` 用 `contains` 匹配 `store_name`，因为数据中是「比亚迪华东旗舰店」而 Router 抽出的是「华东旗舰店」。
9. 时间范围解释器只覆盖「近一个月/三个月/半年」与「Qx」，无法翻译时直接跳过 filter（容错优先）。
10. 每次 routing 写入 `logs/router.jsonl`，便于 shadow 模式后续观测。

# 测试用例（src/eval/router-poc.js）

| # | 输入 | 期望 | 备注 |
|---|---|---|---|
| 1 | 查一下华东旗舰店汉EV最近一个月的库龄 | intent_code = dealer.query.inventory，且若 vehicle_model 抽到「汉EV」则结果中至少含一条汉EV | LLM 路径要求 vehicle_model="汉EV" |
| 2 | 宋L 还有多少配额 | intent_code = dealer.query.inventory | PoC 范围下「配额」也归到 inventory |
| 3 | 华南标准店库存怎么样 | intent_code = dealer.query.inventory | store_name=「华南标准店」用 contains |
| 4 | 你好 | handler_type = chitchat | |
| 5 | 对比华东旗舰店和华南标准店哪家库存压力更大 | handler_type 非 chitchat/intent_query 或 confidence != high | 应进入 agentic |
| 6 | 把这个改成海豹 | DEFER | continuation 暂未实现，标记为 deferred |

# 兜底说明

如果 `LLM_API_KEY` 未配置 / 网络异常 / Router LLM 输出解析失败：

- Router 退化到 `localLLM.recognizeIntent`，按 PoC 规则把 dealer 关键词的 DATA_QUERY 映射到 `dealer.query.inventory`。
- 本地兜底带极简启发式抽参（model 列表 + 门店名 + 时间词 + 预警等级），仅当 LLM 不可用时启用。
- 若用户问句里没有任何 `vehicle_model` 候选词，本地兜底会把 `vehicle_model` 设为 null，filters 为空——查询仍然会返回 dealer_vehicles 全表（受权限/scope 限制），因此 case 1 在没有 LLM 时仅校验「intent_code 命中且查询不崩」。
- 关键：原有 `local-llm.js` 关键词规则原封不动保留，仅作为熔断保险。

# 验证（待人工跑通）

由于本会话沙盒不允许我执行 `npm run`，以下命令需要人工跑一遍：

```bash
# 1. v1 路径无回归
npm run smoke
npm run eval

# 2. v2 路径
INTENT_ROUTER_V2=on npm run eval:router
INTENT_ROUTER_V2=on npm run smoke
```

期望：

- `npm run smoke` / `npm run eval` 与 PoC 之前一致（不启用 v2 时所有逻辑短路掉了）。
- `INTENT_ROUTER_V2=on npm run eval:router` 5/6 PASS + 1 DEFER（case 6）。
- `INTENT_ROUTER_V2=on npm run smoke` 不崩（具体答案可能略有变化，因为 smoke 用的是 sales_001、问的客户/订单类问题——这类目前在 v2 注册表里没有 code，会走 fallback general/agentic 然后落回 v1 原有路径）。

# 验证后请补充

执行上述命令后，请把输出贴回这一节：

```
（待补：npm run smoke 输出）

（待补：npm run eval 输出）

（待补：INTENT_ROUTER_V2=on npm run eval:router 输出）

（待补：INTENT_ROUTER_V2=on npm run smoke 输出）
```

# 实施过程的发现

1. `data/dealer-vehicles.json` 的 `store_name` 是「比亚迪华东旗舰店」而非「华东旗舰店」，因此 store filter 必须用 `contains` 而非 `eq`。
2. `query_business_data` 工具的 `op` 枚举只接受 `eq|neq|contains|in|gte|lte`，没有 `ilike`——本来设计文档里写的 `ilike` 已替换为 `contains`。
3. `dealer_vehicles` 没有 `stock_in_date` 字段，实际是 `inbound_date`；handler 已使用正确字段名。
4. 用户表里没有任何用户配 `dealer:read` 权限，但 `canReadDealerResource` 兼容 `store_general_manager` 角色与 `inventory:read|order:read|sales_report:read` 任一权限——eval 选择 `store_gm_001` 完全可读。
5. `OpenAILLMClient` 没有暴露通用 `chat()` 方法，所有调用都直接 `fetch`。`IntentRouter` 也走 fetch，但完整复用了同一组 env 变量（`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_DECISION_MODEL`），未引入新 LLM provider。
6. v2 入口在 `runStream` 上没接——PoC 范围内只验证非流式路径，如设计文档允许。流式路径的接入留到下一阶段。
7. 部分 Minimax/兼容服务端不接受 `response_format: { type: "json_object" }`——Router 已带「先尝试加 json_object，HTTP 失败则剥掉重试一次」的兼容路径。

# Deferred 事项

- continuation（设计文档 §7.2 case 6）：需要 router prompt 显式注入 `session_state.last_task`，并允许 Router 输出「沿用上一轮 intent_code、合并 params」。本期未做，eval 用例已标记为 DEFER。
- 流式路径（`runStream`）目前仍走 v1 链路。
- `sub_tools_available=true` 的虚拟工具尚未注册到 agentic loop（设计文档 §6.4），因为 PoC 范围内没有跨域分析需要。
- `dealer.analyze.*` 等其他 dealer code 未建 manifest（设计文档 §10.2 Q3 待用户拍板）。
- shadow 模式的双跑日志比对脚本未做。

# 建议下一步

1. 人工跑通上方四条命令，把输出贴到本文件「验证后请补充」一节。
2. 如 case 1 在 LLM 路径下未抽出 `vehicle_model="汉EV"`，需调整 router prompt 的 few-shot（添加「汉EV」反例）。
3. 把 continuation 用例打开，做 router-prompt 与 last_task 联动的最小实现。
4. 评估是否要把 `runStream` 也接到 v2 入口（CLI/前端是否依赖 stream）。
5. 与用户对齐设计文档 §10.2 的 5 个未决问题，特别是 Q2（business-query 是否拆 3 个 code）。

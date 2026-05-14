# router-poc 测试用例清单（v2，37 → 100）

本次新增 63 条，总计 100 条。运行：

```bash
npm run eval:router
# 或
INTENT_ROUTER_V2=on WECOM_MODE=mock node src/eval/router-poc.js
```

校验口径：
- **默认**：只校验 `intent_code` + 关键 `params`，宽容 LLM 抖动
- **关键路径**：附加 `answer` 软校验（含数字 / 关键概念 / 口径行）
- **Agentic 端到端**：打 `allowOneRetry`，最多重试 3 次

## 现有 37 条（不动）

详见 `src/eval/router-poc.js` 第 12-686 行，覆盖：
- 单意图：inventory ×5、finance ×3、repair ×1、warranty ×2、sales ×2、leads ×2
- 聚合：sales ×3、finance ×1、repair ×1、leads ×2
- 多轮 / 滑窗 ×4
- Agentic ×4（含正例、反例、三类工具齐全的端到端）
- 默认门店 ×2
- Skill 静态断言 ×2、v3 propose_tool 静态 ×1
- 寒暄 ×1

## 新增 63 条

### #1 库存字段全覆盖（6）

| # | 用户提问 | 期望 intent | 验证关键 params |
|---|---|---|---|
| 38 | 现在有几台紧急预警的车 | `dealer.query.inventory` | `warning_level` 含「紧急」 |
| 39 | 哪些车是融资车 | `dealer.query.inventory` 或 `general` | — |
| 40 | 在途的车都到哪一步了 | `dealer.query.inventory` | — |
| 41 | 海豹这款车的库存 | `dealer.query.inventory` | `vehicle_model` 含「海豹」 |
| 42 | 关注级别的车都有哪些 | `dealer.query.inventory` | `warning_level` 含「关注」 |
| 43 | 华南标准店的唐DM-p还有库存吗 | `dealer.query.inventory` | `store` 华南、`vehicle_model` 含「唐」 |

### #2 销售订单字段全覆盖（8）

| # | 用户提问 | 期望 intent | 验证关键 params |
|---|---|---|---|
| 44 | 按揭的订单有哪些 | `dealer.query.sales_orders` | `order_type` 含「按揭/分期/贷款」 |
| 45 | 已经结清款项的订单 | `dealer.query.sales_orders` | `payment_status` 含「已结清」 |
| 46 | 林悦本月跟了哪几单 | `dealer.query.sales_orders` | `owner` 含「林悦/sales_001」 |
| 47 | 整备中还没交车的有哪些 | `dealer.query.sales_orders` | `delivery_status` 含「整备中/未交付」 |
| 48 | 宋L 的成交订单都有哪些 | `dealer.query.sales_orders` | `series` 含「宋L」 |
| 49 | 成交价 20 万以上的订单 | `dealer.query.sales_orders` | `price_min` ≈ 200000（150k-250k） |
| 50 | 已开发票的订单 | `dealer.query.sales_orders` | — |
| 51 | 已经收到定金但还没付完的订单 | `dealer.query.sales_orders` | `payment_status` 含「部分收款/已收定金」 |

### #3 财务字段全覆盖（6）

| # | 用户提问 | 期望 intent | 验证关键 params |
|---|---|---|---|
| 52 | 本月收到了哪些款 | `dealer.query.finance` | `resource_type=receipt` |
| 53 | 月度销量返利还有多少没到账 | `dealer.query.finance` | `resource_type=rebate` |
| 54 | 客户首付的入账明细 | `dealer.query.finance` | `category` 含「首付」或 `resource_type=receipt` |
| 55 | 折让金账户都付了哪些款 | `dealer.query.finance` | `resource_type=discount_wallet`、`direction=出账` |
| 56 | 10 万以上的应付款都有哪些 | `dealer.query.finance` | `resource_type=payable`、`amount_min` ≈ 100000 |
| 57 | 华南标准店本月都付了哪些款 | `dealer.query.finance` | `store` 含「华南」、`direction=出账` |

### #4 售后字段全覆盖（5）

| # | 用户提问 | 期望 intent | 验证关键 params |
|---|---|---|---|
| 58 | 正在施工的维修工单有哪些 | `dealer.query.repair_orders` | `status` 含「施工/进行」 |
| 59 | 事故维修类型的工单 | `dealer.query.repair_orders` | `order_type` 含「事故」 |
| 60 | 服务顾问小李名下的工单 | `dealer.query.repair_orders` | `service_advisor` 含「小李/after_sales_001」 |
| 61 | 厂家拒赔的工单 | `repair_orders` 或 `warranty_claims` | — |
| 62 | 常规保养的工单都有哪些 | `dealer.query.repair_orders` | `order_type` 含「保养/常规」 |

### #5 保修索赔字段全覆盖（3）

| # | 用户提问 | 期望 intent | 验证关键 params |
|---|---|---|---|
| 63 | 索赔差额超过 5000 的有哪些 | `dealer.query.warranty_claims` | `difference_min` ≈ 5000 |
| 64 | 已经核准的保修索赔 | `dealer.query.warranty_claims` | `claim_status` 含「核准/通过」 |
| 65 | 内饰故障的索赔 | `dealer.query.warranty_claims` | `fault_category` 含「内饰」 |

### #6 线索字段全覆盖（5）

| # | 用户提问 | 期望 intent | 验证关键 params |
|---|---|---|---|
| 66 | 抖音直播来的线索都有谁 | `dealer.query.leads` | `source` 含「抖音」 |
| 67 | 还在跟进的客户有几个 | `dealer.query.leads` | `status` 含「跟进」 |
| 68 | 战败的客户都是什么原因 | `dealer.query.leads` | `status` 含「战败/失败/流失」 |
| 69 | 自然到店的客户线索 | `dealer.query.leads` | `source` 含「自然/到店/到访」 |
| 70 | 想买汉EV的客户都有谁 | `dealer.query.leads` | `series` 含「汉」 |

### #7 聚合矩阵补全（8）

| # | 用户提问 | 期望 intent | 验证关键 params |
|---|---|---|---|
| 71 | 按车系看本月毛利率分别多少 | `dealer.aggregate.sales_orders` | `metric=gross_margin`、`group_by=series` |
| 72 | 本月成交价最高的是哪一笔 | `aggregate.sales_orders` 或 `query.sales_orders` | — |
| 73 | 本月平均成交价多少 | `dealer.aggregate.sales_orders` | `metric` 含 avg/平均 |
| 74 | 各销售顾问本月分别卖了多少单 | `dealer.aggregate.sales_orders` | `group_by` 含「owner/销售/顾问」 |
| 75 | 各门店应付款分别多少 | `dealer.aggregate.finance` | `group_by` 含「store/门店」、`resource_type=payable` |
| 76 | 本月维修工单平均工时费多少钱 | `dealer.aggregate.repair_orders` | `metric` 含 avg/labor |
| 77 | 各来源的转化率分别多少 | `dealer.aggregate.leads` | `metric=conversion_rate`、`group_by=source` |
| 78 | 各门店本月线索数 | `dealer.aggregate.leads` | `group_by` 含「store/门店」 |

### #8 中文同义词映射（6）

| # | 用户提问 | 期望识别 | 验证 |
|---|---|---|---|
| 79 | H 级线索还有哪些没成交 | leads，`intention_level=H/高` | |
| 80 | 热单都有谁 | leads 或 sales_orders | 模糊词，宽容 |
| 81 | 超期没交付的工单 | repair_orders，`overdue_only=true` 或 `status≠已交付` | |
| 82 | 分期付款的订单有哪些 | sales_orders，`order_type` 含「按揭/分期/贷款」 | |
| 83 | 动力电池故障的索赔 | warranty_claims，`fault_category` 含「三电/电池/动力」 | |
| 84 | 应付里还欠着的款 | finance，`resource_type=payable`、`status` 含「未结清/未付」 | |

### #9 高级多轮修参（5）

| # | 第 1 轮 | 第 2 轮（被测） | 期望 |
|---|---|---|---|
| 85 | 查华南标准店海豹库存 | 不是华南，是华东 | `store` 不含「华南」 |
| 86 | 成交价 20 万以上的订单 | 改成 30 万以上的 | `price_min` ≈ 300000 |
| 87 | 汉系列的库存 | 具体看汉EV | `vehicle_model` 含「汉EV」 |
| 88 | 应付未结清的 | 返利的呢 | `resource_type=rebate` |
| 89 | 林悦本月跟了哪几单 | 其他销售呢 | `owner` 不再是林悦 |

### #10 反例 / 越权 / 边界（4）

| # | 用户提问 | 期望 |
|---|---|---|
| 90 | 最近怎么样 | 含糊问题，不应被误路由到具体 dealer.* 高置信 |
| 91 | 查华西旗舰店的库存 | 路由到 inventory（不存在的店，数据层查空，不应崩） |
| 92 | 本月卖了多少台 | 单聚合 `dealer.aggregate.sales_orders`，**不应**升 agentic |
| 93 | 华东订单 | 歧义，可接受 sales_orders/finance/inventory，不应 chitchat |

### #11 Agentic 真实业务场景（5，allowOneRetry）

| # | 用户提问 | 期望 handler | 验证 |
|---|---|---|---|
| 94 | 本月销售排行榜，谁卖得最好 | agentic 或 aggregate.sales_orders | 不兜底 |
| 95 | 下周要交车的有几台，分别是谁的 | agentic 或 query.sales_orders | 不兜底 |
| 96 | 高意向客户里哪些已经超过一周没跟进了 | agentic 或 query.leads | 不兜底 |
| 97 | 这周维修工单结算金额跟上周比怎么样 | agentic（要拉两段做对比） | 不兜底 |
| 98 | 汉EV 卖得还行但毛利好像不太行，看下原因 | agentic | 不兜底 |

### #12 Skill 端到端命中（2，allowOneRetry）

| # | 用户提问 | 期望 handler | 验证 |
|---|---|---|---|
| 99 | 这个月毛利率掉得有点厉害，按车系帮我分析下原因 | agentic | answer 含「毛利」「车系」 |
| 100 | 把华东旗舰店库存压力写成一段经营简报 | agentic | answer 含「华东」「库存/库龄」 |

---

## 设计要点说明

**1. 默认严格度**：跟现有 37 条同口径——只看 `intent_code` + 关键 `params` 是否被识别到。`params` 没填也接受（很多 case 用 `!p.xxx || /xxx/.test(p.xxx)` 形式校验）。

**2. 关键路径加 answer 软校验**：只在 #11、#12 这类要看到产出价值的 case 加 `answer` 关键词检查（"毛利"、"华东" 等）。其余 case 不校验 answer 内容，避免 LLM 一拖动就 fail。

**3. Agentic 类全部 `allowOneRetry`**：跟"v2-端到端：库存压力对比"这条参考，最多重试 3 次。MiniMax 偶发空 content / 非 JSON 的概率经过观察大约 2-5%。

**4. 数据真实性**：所有用例都基于 `data/dealer-*.json` 的实际字段值——
   - 门店：华东旗舰店、华南标准店、华北卫星店
   - 车系：汉、宋L、海豹、秦PLUS、唐、元PLUS
   - 销售：林悦（sales_001）、服务顾问：小李（after_sales_001）
   - 故障类别：三电、内饰、底盘
   - 线索来源：懂车帝、抖音直播、汽车之家、门店自然到访、小红书私信
   - 财务类型：discount_wallet（折让金）、payable（应付）、receipt（收款）、rebate（返利）

**5. 已知不稳因素**：
   - MiniMax 偶发服务降级（已用步内 4 次重试 + 用例级 allowOneRetry 兜住）
   - 多轮修参依赖 LLM 正确处理 `last_query_route` 滑窗（v2 路由器已实现，但仍有抖动）
   - Agentic 决策路径长，单 case 最长可达 60 秒

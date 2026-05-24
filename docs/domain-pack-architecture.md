# Domain Pack 业务解耦架构方案

本文定义下一阶段的核心目标：把当前汽车经销业务从 Agent Runtime 中解耦出来，形成可插拔的 `DomainPack` 机制。目标不是立刻新增第二个行业，而是先把 `dealer` 作为第一个业务包迁移成功，证明 runtime 可以承载不同业务类型。

## 背景

当前项目已经完成 Agent Runtime 基座：

```text
QueryEngine
Transcript
Memory Retriever
Compaction
ToolRegistry
ToolCatalog
PlanMode
A2UI Workbench
Task / Cron
Gateway
Skill Governance
Subagent Hooks
```

这些能力大体是业务无关的。但汽车经销业务仍散落在核心代码中：

```text
src/app.ts                         手工注册所有业务工具、命令、handler
src/tools/business-tools.ts        RESOURCE_CONFIG 混合 customers / attendance / dealer
src/router/default-commands.ts     默认命令写死 dealer 场景
src/router/deterministic-rule-registry.ts  regex / extractor 写死 dealer 与 attendance
src/handlers/intent-query-handler.ts       部分 filter/default/transform 是业务特例
src/tools/tool-catalog.ts          domain taxonomy 偏 dealer
data/intent-codes/*.json           所有业务意图在同一目录
src/eval/router-poc.ts             dealer 回归和 runtime 回归混在一起
```

这会导致新增业务类型时必须修改 runtime 核心，长期会变成"一个行业加一堆 if"。

## 目标

把业务域封装成可注册的 `DomainPack`：

```text
runtime core:
  QueryEngine / ToolRegistry / Router / Handler / A2UI / Gateway

domain pack:
  resources / tools / intents / commands / deterministic rules / transforms / surfaces / evals
```

完成后，新增业务类型应尽量只需要：

```text
src/domains/<domain>/
data/domains/<domain>/
docs/domain-<domain>.md
```

而不修改：

```text
src/runtime/*
src/router/*
src/handlers/*
src/tools/registry.ts
src/server/http.ts
src/a2ui/adapter.ts
```

## 非目标

本阶段不做：

```text
新增第二个真实业务行业
重写 QueryEngine
重写 ToolRegistry
重写 IntentRouter LLM prompt
重写 A2UI 协议
迁移所有历史 eval 命名
```

本阶段只做一件事：**把 dealer / attendance / knowledge 当前业务能力迁成 DomainPack，并保持回归不退化。**

## 核心接口

建议新增：

```text
src/domains/types.ts
src/domains/registry.ts
src/domains/index.ts
```

核心类型：

```ts
export interface DomainPack {
  id: string;
  name: string;
  description?: string;
  dependencies?: string[];
  optionalDependencies?: string[];

  resources?: ResourceConfig[];
  tools?: ToolDefinition[];
  commands?: CommandDefinition[];
  deterministicRules?: DeterministicRuleDefinition[];
  intentManifests?: IntentManifest[];
  skills?: DomainSkillConfig[];
  surfaces?: DomainSurfaceBuilder[];
  catalogDomains?: CatalogDomainDefinition[];

  init?(ctx: DomainInitContext): void | Promise<void>;
  register?(ctx: DomainRegistrationContext): void | Promise<void>;
  dispose?(ctx: DomainDisposeContext): void | Promise<void>;
}

export interface DomainRegistrationContext {
  toolRegistry: ToolRegistry;
  intentRegistry: MutableIntentRegistry;
  commandRegistry: CommandRegistry;
  deterministicRules: DeterministicRuleRegistry;
  catalogRegistry: ToolCatalogDomainRegistry;
  surfaceRegistry: A2UISurfaceRegistry;
}
```

设计约束：

```text
1. 能声明式注册的能力，不放进 register()。
2. register() 只处理远程初始化、条件注册、复杂依赖注入等逃生口。
3. toy domain 禁止使用 register()，用于验证声明式接口是否足够。
4. dependencies 用于声明强依赖，optionalDependencies 用于声明可选增强。
5. init / dispose 只处理生命周期，不承载业务注册。
```

权限命名建议统一为：

```text
<domain>:<resource>:<action>

dealer:inventory:read
dealer:finance:read
attendance:leave:write
knowledge:policy:read
```

## 目录结构

目标结构：

```text
src/domains/
  types.ts
  registry.ts
  index.ts

  dealer/
    domain-pack.ts
    resources.ts
    tools.ts
    commands.ts
    deterministic-rules.ts
    intent-manifests.ts
    catalog-domains.ts
    a2ui-surfaces.ts
    eval/
      dealer-smoke.ts
      router-poc.ts

  attendance/
    domain-pack.ts
    resources.ts
    tools.ts
    deterministic-rules.ts
    intent-manifests.ts

  knowledge/
    domain-pack.ts
    tools.ts
    deterministic-rules.ts
    intent-manifests.ts
```

数据结构：

```text
data/domains/
  dealer/
    stores.json
    vehicles.json
    inbounds.json
    quotas.json
    leads.json
    sales-orders.json
    finance.json
    repair-orders.json
    warranty-claims.json
    intent-codes/*.json

  attendance/
    leave-requests.json
    fixtures/
    intent-codes/*.json

  knowledge/
    intent-codes/*.json
```

兼容期可以保留 `data/dealer-*.json`，由 domain resource 指向旧路径；迁移数据目录作为第二阶段。

## 解耦对象

### 1. Resource 解耦

当前问题：

```text
src/tools/business-tools.ts 内 RESOURCE_CONFIG 写死所有资源
```

目标：

```text
BusinessDataTool 只负责 query / aggregate 执行
ResourceRegistry 负责管理资源定义
DomainPack 注册 ResourceConfig[]
```

建议新增：

```text
src/resources/types.ts
src/resources/registry.ts
src/resources/business-data-tool.ts
```

迁移后：

```ts
resourceRegistry.registerMany(dealerResources);
toolRegistry.register(createBusinessDataTool({ resourceRegistry }));
```

验收：

```text
dealer_vehicles / dealer_sales_orders / leave_requests 查询结果不变
npm run eval:dealer
npm run eval:router
npm run eval:task-tools
```

### 2. Commands 解耦

当前问题：

```text
src/router/default-commands.ts 写死 /今日订单 /库存预警 /三包
```

目标：

```text
Core 只提供 CommandRegistry
DomainPack 提供 commands
```

迁移后：

```text
src/domains/dealer/commands.ts
src/domains/core/commands.ts 或 src/router/core-commands.ts
```

保留 core 命令：

```text
/help
```

迁移到 dealer：

```text
/今日订单
/库存预警
/我的线索
/三包
```

验收：

```text
npm run commands:api
npm run router:commands
```

### 3. Deterministic Rules 解耦

当前问题：

```text
src/router/deterministic-rule-registry.ts 内置大量 dealer / attendance regex 和 extractor
```

目标：

```text
DeterministicRuleRegistry 只负责规则执行
DomainPack 注册规则和 extractor
```

建议接口：

```ts
export interface DeterministicRuleDefinition {
  id: string;
  intentCode: string;
  priority?: number;
  patterns?: string[];
  negativePatterns?: string[];
  extractors?: Record<string, string | ExtractorSpec | ExtractorFn>;
  params?: JsonObject;
  match?: (input: RuleInput) => RuleMatch | null;
}

export interface DomainExtractor {
  name: string;
  extract(text: string, ctx: ExtractorContext): JsonValue | undefined;
}

export interface ExtractorSpec {
  use: string;
  default?: JsonValue;
  args?: JsonObject;
}
```

Extractor 设计原则：

```text
1. 字符串引用用于最常见场景：store: "dealer.store"。
2. ExtractorSpec 用于组合：leave_time_range: { use: "attendance.leave_time_range", default: "近三个月" }。
3. ExtractorFn 是 TypeScript domain pack 的逃生口，不进入 JSON manifest。
4. JSON manifest 中只允许 string / ExtractorSpec，不允许函数。
```

规则合并排序必须保留当前行为语义：

```text
priority ASC
domainOrder ASC
declarationIndex ASC
```

说明：

```text
priority 控制跨业务域的显式优先级。
domainOrder 来自 DomainRegistry.registerMany([...]) 的注册顺序。
declarationIndex 保留同一个 domain 内数组声明顺序，避免迁移后 eval:router 退化。
```

迁移顺序：

```text
1. manifest deterministic_rules 继续保留
2. 将 hardcoded dealer rules 迁到 src/domains/dealer/deterministic-rules.ts
3. 将 leave rules 迁到 src/domains/attendance/deterministic-rules.ts
4. core 只保留 smalltalk / command 级别规则
```

验收：

```text
npm run eval:router  # 100/100
npm run eval:dealer
npm run leave-skill-regression 或 npm run eval 对应脚本
```

### 4. Intent Manifest 解耦

当前问题：

```text
data/intent-codes/*.json 单目录承载所有业务
```

目标：

```text
IntentRegistry 支持多个 manifest source
DomainPack 可注册 intentManifests 或 intentDir
```

建议：

```ts
new IntentRegistry({
  dirs: [
    "data/intent-codes",
    "data/domains/dealer/intent-codes",
    "data/domains/attendance/intent-codes"
  ]
})
```

或者由 DomainPack 直接：

```ts
intentRegistry.registerMany(dealerIntentManifests)
```

兼容策略：

```text
第一阶段继续读取 data/intent-codes
第二阶段迁移到 data/domains/*/intent-codes
第三阶段旧目录只保留 core/system/general
```

### 5. IntentQueryHandler 业务特例解耦

当前问题：

`IntentQueryHandler` 中仍有：

```text
attendance.leave_query 特例
dealer.query.inventory 特例
dealer.query.repair_orders 特例
dealer_metrics 文案补丁
```

目标：

```text
通用 handler 只做：
manifest -> params -> filters -> tool call -> summarize

业务特殊逻辑通过 DomainQueryAdapter 注入：
applyDefaults()
buildFilters()
buildSort()
formatAnswer()
postProcessAnswer()
```

建议接口：

```ts
export interface DomainQueryAdapter {
  domain: string;
  supports(input: QueryAdapterInput): boolean;
  applyDefaults?(input: DefaultsInput): DefaultsResult;
  buildFilters?(input: FiltersInput): QueryFilter[] | null;
  buildSort?(input: SortInput): QuerySort[] | null;
  postProcessAnswer?(input: AnswerPostProcessInput): string;
}
```

`AnswerPostProcessInput` 必须包含最终 answer 和工具上下文，确保现有依赖答案内容的补丁逻辑可以完整迁出：

```ts
export interface AnswerPostProcessInput {
  answer: string;
  rows: DataRecord[];
  toolResult?: ToolResult;
  params: JsonObject;
  route: Route;
  manifest: IntentManifest;
  user?: UserContext;
  message?: string;
}
```

典型迁移对象：

```text
dealer_metrics 同时问库存和线索时，如果 answer 漏掉线索维度，则由 DealerQueryAdapter.postProcessAnswer() 补说明。
attendance.leave_query 的默认范围、部门、人群过滤由 AttendanceQueryAdapter.buildFilters() 接管。
```

迁移顺序：

```text
1. 新增 DomainQueryAdapterRegistry
2. Milestone 4a：把 attendance.leave_query 逻辑迁到 AttendanceQueryAdapter
3. Milestone 4b：把 dealer.query.* 逻辑迁到 DealerQueryAdapter
4. IntentQueryHandler 中只保留 fallback generic mapping
```

验收：

```text
npm run eval:router
npm run eval:dealer
npm run eval
```

### 6. ToolCatalog Domain Taxonomy 解耦

当前问题：

```text
ToolCatalog 中 BusinessDomain 枚举偏 dealer
```

目标：

```text
DomainPack 注册 catalogDomains
Tool metadata 可显式声明 domain
没有声明时才 fallback prefix inference
```

建议结构：

```ts
export interface CatalogDomainDefinition {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  ownerDomain?: string;
}
```

工具 metadata 建议增加：

```ts
metadata: {
  domain: "dealer.inventory",
  capability: "inventory.query",
  data_source: "dealer_vehicles",
  business_terms: ["库存", "库龄", "融资车"]
}
```

验收：

```text
npm run eval:tool-catalog
npm run eval:tool-catalog-http
```

### 7. A2UI Surface 解耦

当前问题：

Workbench builder 是通用的，但真实业务 surface 触发还需要领域逻辑。

目标：

```text
DomainPack 可注册 SurfaceBuilder
surface builder 根据 tool result / intent_code / capability 生成业务 UI
```

建议接口：

```ts
export interface DomainSurfaceBuilder {
  id: string;
  domain: string;
  supports(input: SurfaceBuildInput): boolean;
  build(input: SurfaceBuildInput): A2UIEnvelope | null;
}
```

迁移方向：

```text
dealer risk list
dealer metric cards
dealer evidence surface
attendance leave form
knowledge sources
```

验收：

```text
npm run a2ui:adapter
npm run a2ui:regression
```

## 迁移路线

### Milestone 1：DomainPack 基座

目标：不迁业务，只先建注册机制。

改动：

```text
src/domains/types.ts
src/domains/registry.ts
src/domains/index.ts
src/app.ts 接入 DomainRegistry
```

验收：

```text
npm run build:ts
npm run smoke
```

### Milestone 2：ResourceRegistry

目标：把 `RESOURCE_CONFIG` 从 `business-tools.ts` 拔出。

改动：

```text
src/resources/types.ts
src/resources/registry.ts
src/resources/business-data-tool.ts
src/domains/dealer/resources.ts
src/domains/attendance/resources.ts
```

验收：

```text
npm run eval:dealer
npm run eval:router
npm run eval:task-tools
```

### Milestone 2.5：retail-demo Toy Domain

目标：在迁移复杂 dealer 规则前，用一个极小业务域验证 DomainPack 声明式注册真的可用。

约束：

```text
1. 禁止使用 register() 逃生口。
2. 只能使用 resources / commands / deterministicRules / intentManifests 声明式字段。
3. 不允许修改 router / handler / ToolRegistry core。
```

能力范围：

```text
查询门店销量
查询库存告警
```

建议目录：

```text
src/domains/retail-demo/
  domain-pack.ts
  resources.ts
  commands.ts
  deterministic-rules.ts
  intent-manifests.ts
  eval/retail-demo-smoke.ts

data/domains/retail-demo/
  stores.json
  sales.json
  inventory-alerts.json
```

验收：

```text
npm run build:ts
npm run eval:domain:retail-demo
```

### Milestone 3：Commands + Rules

目标：把命令和确定性规则迁入 domain。

改动：

```text
src/domains/dealer/commands.ts
src/domains/dealer/deterministic-rules.ts
src/domains/attendance/deterministic-rules.ts
src/router/deterministic-rule-registry.ts 只保留执行器
```

验收：

```text
npm run commands:api
npm run router:commands
npm run eval:router
```

### Milestone 4a：AttendanceQueryAdapter

目标：先迁最小业务特例，验证 QueryAdapterRegistry 接口。

改动：

```text
src/domains/query-adapter.ts
src/domains/attendance/query-adapter.ts
src/handlers/intent-query-handler.ts
```

验收：

```text
npm run leave-skill-regression
npm run eval
```

### Milestone 4b：DealerQueryAdapter

目标：把 `IntentQueryHandler` 里的 dealer 业务特例迁出。

改动：

```text
src/domains/dealer/query-adapter.ts
src/handlers/intent-query-handler.ts
```

验收：

```text
npm run eval:router
npm run eval:dealer
npm run eval
```

### Milestone 5：Catalog + A2UI Domain Surface

目标：让业务能力目录和业务 UI 都可由 domain 注册。

改动：

```text
src/tools/tool-catalog.ts
src/domains/dealer/catalog-domains.ts
src/domains/dealer/a2ui-surfaces.ts
```

验收：

```text
npm run eval:tool-catalog
npm run eval:tool-catalog-http
npm run a2ui:adapter
npm run a2ui:regression
```

### Milestone 6：文档和评测拆分

目标：让 runtime eval 和 domain eval 分离。

改动：

```text
docs/domain-pack-architecture.md
README.md
src/domains/dealer/eval/*
package.json scripts
```

验收：

```text
npm run eval:runtime
npm run eval:domain:dealer
npm run regress:all
```

## 完成标准

本阶段完成后，应满足：

```text
1. dealer 是一个 DomainPack，而不是散落在 runtime core。
2. app.ts 不直接 import dealer 具体工具/规则/命令，只注册 domain pack。
3. 新增一个 toy domain 不需要修改 router / handler / registry 核心。
4. eval:router 仍保持 100/100。
5. ToolCatalog 能显示 domain 注册的分类。
6. A2UI 能由 domain surface builder 生成业务面板。
7. README 能说明如何新增一个业务域。
```

建议新增一个最小 toy domain 用于证明解耦：

```text
src/domains/retail-demo/
  domain-pack.ts
  resources.ts
  intent-manifests.ts
  deterministic-rules.ts
  eval/retail-demo-smoke.ts
```

toy domain 只需要支持：

```text
查询门店销量
查询库存告警
```

如果 toy domain 能不改 core 跑通，说明架构真正解耦。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 大规模迁移导致 router 退化 | dealer 用例多，regex 迁移容易漏 | 每个 milestone 都跑 `eval:router` |
| 规则优先级漂移 | 当前 hardcoded rules 数组顺序有隐性语义 | 合并规则时按 priority / domainOrder / declarationIndex 排序 |
| 过度抽象 | 还没第二个真实业务就抽太复杂 | 只抽当前明确耦合点，保留兼容层 |
| manifest 表达力不足 | filter/default/transform 不能全配置化 | 用 DomainQueryAdapter 作为逃生口 |
| extractor 表达力不足 | 仅字符串引用无法表达默认值和组合 | 支持 ExtractorSpec；函数只作为 TS escape hatch |
| A2UI surface 分散 | 每个 domain 都乱造 surface | 保留通用 Workbench builder，domain 只做 data mapping |
| 旧路径兼容 | data/intent-codes 和 data/domains/* 并存 | 设三阶段迁移，不一次性删除旧路径 |

## 推荐下一步

在当前分支 `codex/domain-pack-architecture` 中，先完成 Milestone 1 + Milestone 2：

```text
1. 新增 DomainPack / DomainRegistry 类型。
2. 新增 ResourceRegistry。
3. 将 RESOURCE_CONFIG 拆成 core / dealer / attendance 三组。
4. createBusinessTools({ resourceRegistry }) 取代内部硬编码 RESOURCE_CONFIG。
5. 保持现有数据路径不变，只迁代码组织。
6. 跑 build:ts + eval:dealer + eval:router。
```

完成 Milestone 1 + 2 后，立即插入 Milestone 2.5：

```text
1. 新增 retail-demo toy domain。
2. 只使用声明式注册，不使用 register()。
3. 证明新增业务不改 core 也能跑通。
4. 再进入 Commands + Rules 迁移。
```

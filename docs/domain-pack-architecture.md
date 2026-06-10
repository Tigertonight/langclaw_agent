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
OpenUI Lang Workbench
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
  QueryEngine / ToolRegistry / Router / Handler / OpenUI Lang / Gateway

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
src/openui-lang/*
```

## 非目标

本阶段不做：

```text
新增第二个真实业务行业
重写 QueryEngine
重写 ToolRegistry
重写 IntentRouter LLM prompt
重写 OpenUI Lang 协议
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

### 7. OpenUI Lang Surface 解耦

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
  build(input: SurfaceBuildInput): OpenUILangSurface | null;
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
npm run openui:adapter
npm run openui:regression
```

## 迁移路线

### Milestone 1：DomainPack 基座 ✅

> **状态**：已完成。DomainPack 类型系统和 DomainRegistry 注册中心已建立。

目标：不迁业务，只先建注册机制。

改动：

```text
src/domains/types.ts          ✅ 核心类型定义（DomainPack / DomainQueryAdapter / ExtractorSpec 等）
src/domains/registry.ts       ✅ DomainRegistry（Kahn 拓扑排序 + 三级规则排序 + 生命周期管理）
src/domains/index.ts          ✅ 统一导出
src/app.ts                    ✅ 接入 DomainRegistry，registerMany 四个 pack
```

验收：

```text
npm run build:ts              ✅ 零错误
npm run smoke                 ✅
```

### Milestone 2：ResourceRegistry ✅

> **状态**：已完成。ResourceRegistry 已接入 `query_business_data`，运行时查询从 DomainPack.resources 取资源。

目标：把 `RESOURCE_CONFIG` 从 `business-tools.ts` 拔出。

改动：

```text
src/resources/types.ts                    ✅ ResourceConfig / FieldLabels 类型
src/resources/registry.ts                 ✅ ResourceRegistry 实现
src/resources/index.ts                    ✅ 统一导出
src/domains/core/resources.ts             ✅ customers / orders / sales_reports
src/domains/dealer/resources.ts           ✅ dealer_vehicles / dealer_sales_orders / ...
src/domains/attendance/resources.ts       ✅ leave_requests
src/tools/business-tools.ts              ✅ createBusinessTools({ resourceRegistry })
```

残留：`business-tools.ts` 仍保留完整旧 `RESOURCE_CONFIG` / `FIELD_LABELS` 作为 fallback。后续 M3.5 降级为测试兜底或移除。

验收：

```text
npm run eval:dealer           ✅ 14/14
npm run eval:router           ✅ 100/100
npm run eval:task-tools       ✅
```

### Milestone 2.5：retail-demo Toy Domain ✅

> **状态**：已完成。纯声明式 DomainPack（无 `register()` 逃生口）验证通过，证明新增业务域不改 core 可跑通。

约束：

```text
1. 禁止使用 register() 逃生口。                    ✅ 已验证
2. 只能使用 resources / commands / deterministicRules / intentManifests 声明式字段。  ✅
3. 不允许修改 router / handler / ToolRegistry core。  ✅
```

能力范围：

```text
查询门店销量                   ✅
查询库存告警                   ✅
```

实际目录：

```text
src/domains/retail-demo/
  domain-pack.ts              ✅
  resources.ts                ✅
  commands.ts                 ✅
  deterministic-rules.ts      ✅
  intent-manifests.ts         ✅
  eval/retail-demo-smoke.ts   ✅

data/domains/retail-demo/
  stores.json                 ✅
  sales.json                  ✅
  inventory-alerts.json       ✅
```

验收：

```text
npm run build:ts              ✅
npm run eval:domain:retail-demo  ✅ 13/13
```

### Milestone 3：Commands + Rules ✅

> **状态**：已完成。命令和确定性规则已迁入各 DomainPack，`deterministic-rule-registry.ts` 从 561 行瘦身到 ~130 行纯执行器。

改动：

```text
src/domains/dealer/commands.ts              ✅ 4 个 dealer 命令
src/domains/dealer/deterministic-rules.ts   ✅ 15 条 dealer 规则 + 16 个 extractors
src/domains/attendance/deterministic-rules.ts ✅ 2 条 attendance 规则 + 4 个 extractors
src/domains/core/commands.ts                ✅ /help 命令
src/domains/core/deterministic-rules.ts     ✅ knowledge.policy_qa 规则
src/router/deterministic-rule-registry.ts   ✅ 只保留执行器（~130 行）
src/router/default-commands.ts              ✅ 只保留聚合导出（~17 行）
src/router/intent-registry.ts              ✅ 新增 register() / registerMany()
src/app.ts                                  ✅ 通过 DomainPack 注册命令和规则
```

验收：

```text
npm run build:ts              ✅ 零错误
npm run eval:router           ✅ 100/100
npm run eval:dealer           ✅ 14/14
npm run router:commands       ✅ 11/11
npm run eval:domain:retail-demo  ✅ 13/13（零回归）
```

---

## 审计评估（M1–M3 完成后）

> 以下为代码审计结论，作为 M3.5–M6 迭代计划的输入。

### 已解耦得比较好的部分

```text
✅ src/domains/ 已有 core / dealer / attendance / retail-demo 四个域，结构方向对
✅ retail-demo 作为 toy domain 有效：资源、命令、规则都走声明式配置
✅ ResourceRegistry 已接入 query_business_data，运行时查询不再只从内部 RESOURCE_CONFIG 取资源
✅ deterministic-rule-registry.ts 已从 500+ 行业务规则瘦身成纯规则执行器
✅ 回归全部稳定：build:ts / eval:router 100/100 / eval:dealer 14/14 / retail-demo 13/13
```

### 主要残留耦合

| 耦合点 | 位置 | 说明 |
|---|---|---|
| app.ts 手工枚举 | `src/app.ts:1-10,118-196` | 直接 import 四个 pack、各域 field labels、extractors；新增业务域必须改 app.ts |
| DomainRegistry 未激活 | `src/app.ts:118-120` | 只调了 `registerMany()`，没调 `initialize()`；`allCommands` / `allDeterministicRules` 未成为主路径 |
| IntentQueryHandler 业务硬编码 | `src/handlers/intent-query-handler.ts:185-517` | dealer answer patch、7 个 intent_code 的 buildFilters、applyDefaults 的 default_store 逻辑 |
| business-tools.ts 旧配置 | `src/tools/business-tools.ts:107+` | 完整旧 RESOURCE_CONFIG / FIELD_LABELS 作为 fallback，兼容可以但需逐步降级 |
| ExtractorSpec 未落地 | `src/router/deterministic-rule-registry.ts:126-133` | 只处理函数 extractor，`string \| ExtractorSpec` 在 DomainRule 路径还没真正执行 |
| intent-router.ts 重复 extractors | `src/router/intent-router.ts:626-844` | ~220 行 hardcoded extractors 与 domains/dealer/deterministic-rules.ts 重复 |

### 当前解耦度评估

```text
声明式配置层（resources / commands / rules）：~85%
运行时行为层（query adapter / surface / catalog）：~0%
装配层（app.ts 手工枚举 vs 自动发现）：~30%
综合评估：~45%
```

### 结论

Domain Pack 骨架和第一批迁移已经可运行，新增 toy domain 已验证，核心剩余耦合集中在 **app.ts 装配层** 和 **IntentQueryHandler 查询适配层**。还没有完全进入"新增业务域只注册 pack、不改 runtime"的最终形态。

---

## 迭代计划（M3.5–M6）

### Milestone 3.5：app.ts 装配层收口 + DomainRegistry 激活

> **优先级**：P0（阻塞"新增域不改 runtime"目标）
> **状态**：待开发

目标：消除 `app.ts` 对各域的手工 import 枚举，让 DomainRegistry 成为唯一的配置分发中心。新增业务域只需在 `available-packs.ts` 加一行 import，不改 `app.ts` 主体。

#### 3.5a：统一 Pack 入口

新增 `src/domains/available-packs.ts`，集中管理所有已注册 DomainPack：

```ts
// src/domains/available-packs.ts
import { corePack } from "./core/domain-pack.js";
import { dealerPack } from "./dealer/domain-pack.js";
import { attendancePack } from "./attendance/domain-pack.js";
import { retailDemoPack } from "./retail-demo/domain-pack.js";
import type { DomainPack } from "./types.js";

export const AVAILABLE_PACKS: DomainPack[] = [
  corePack,
  dealerPack,
  attendancePack,
  retailDemoPack,
];
```

`app.ts` 改为：

```ts
import { AVAILABLE_PACKS } from "./domains/available-packs.js";
// 不再 import dealerPack / attendancePack / retailDemoPack / 各域 extractors / field labels
```

#### 3.5b：DomainRegistry.initialize() 激活

将 `createApp()` 拆分为同步构造 + 异步初始化两阶段：

```text
方案 A（推荐）：createApp() 返回 { app, init() }，调用方在启动时 await app.init()
方案 B：createApp() 改为 async，所有调用方适配
```

`initialize()` 激活后，`app.ts` 中的手工收集逻辑全部替换为 DomainRegistry 输出：

```text
allDomainRules       → domainRegistry.allDeterministicRules（已按三级排序）
allCommands          → domainRegistry.allCommands
extractorRegistry    → 从 DomainPack.extractors 字段自动合并（需在 DomainPack 类型中新增 extractors 字段）
resources            → 从 DomainPack.resources 自动注入 ResourceRegistry
fieldLabels          → 从 DomainPack.fieldLabels 自动注入 ResourceRegistry（需在 DomainPack 类型中新增 fieldLabels 字段）
```

#### 3.5c：DomainPack 类型扩展

在 `DomainPack` 接口中新增两个声明式字段，消除 app.ts 对域内部导出的依赖：

```ts
export interface DomainPack {
  // ... 现有字段 ...
  extractors?: Record<string, ExtractorFn>;
  fieldLabels?: Record<string, Record<string, string>>;
}
```

各域 domain-pack.ts 补充这两个字段，app.ts 不再单独 import `DEALER_EXTRACTORS` / `DEALER_FIELD_LABELS` 等。

#### 3.5d：business-tools.ts 旧配置降级

将 `RESOURCE_CONFIG` / `FIELD_LABELS` 从生产路径移除，仅保留在测试 fixture 中：

```text
src/tools/business-tools.ts    移除 RESOURCE_CONFIG / FIELD_LABELS 常量
src/tools/__tests__/fixtures/  保留旧配置作为测试兜底（如有需要）
```

改动文件：

```text
src/domains/types.ts                  扩展 DomainPack 接口
src/domains/available-packs.ts        新增：统一 pack 入口
src/domains/registry.ts               扩展 collectDeclarativeConfigs 收集 extractors / fieldLabels
src/domains/*/domain-pack.ts          补充 extractors / fieldLabels 字段
src/app.ts                            重构：从 DomainRegistry 输出取配置，消除手工枚举
src/tools/business-tools.ts           移除旧 RESOURCE_CONFIG / FIELD_LABELS fallback
```

验收：

```text
npm run build:ts
npm run eval:router           # 100/100
npm run eval:dealer           # 14/14
npm run eval:domain:retail-demo  # 13/13
# 关键验证：新增 toy domain 只改 available-packs.ts，不改 app.ts
```

### Milestone 4a：AttendanceQueryAdapter

> **优先级**：P0（与 M3.5 并行或紧接）
> **状态**：待开发

目标：先迁最小业务特例（attendance.leave_query），验证 QueryAdapter 接口设计。

#### 4a-1：QueryAdapterRegistry 基础设施

新增 `src/domains/query-adapter-registry.ts`：

```ts
export class QueryAdapterRegistry {
  private adapters: DomainQueryAdapter[] = [];

  register(adapter: DomainQueryAdapter): void;
  registerMany(adapters: DomainQueryAdapter[]): void;

  /** 找到第一个 supports() 返回 true 的 adapter */
  resolve(input: QueryAdapterInput): DomainQueryAdapter | null;
}
```

DomainRegistry 在 `collectDeclarativeConfigs()` 中已收集 `allQueryAdapters`，此处只需在 app.ts 中将其注入 QueryAdapterRegistry。

#### 4a-2：AttendanceQueryAdapter 实现

新增 `src/domains/attendance/query-adapter.ts`：

```text
迁移内容（从 intent-query-handler.ts 迁出）：
- attendance.leave_query 的 buildFilters（~40 行，含 scope/leave_type/status/time_range 逻辑）
- inferLeaveType() 辅助函数
- extractMonthToken() 辅助函数
- translateTimeRangeToIso() 引用
```

#### 4a-3：IntentQueryHandler 适配

`IntentQueryHandler` 构造函数新增 `queryAdapterRegistry` 参数：

```ts
constructor({ llm, toolRegistry, registry, queryAdapterRegistry }: {
  // ...
  queryAdapterRegistry?: QueryAdapterRegistry;
})
```

`buildFilters()` 改为先查 adapter，命中则委托，否则走原有逻辑（渐进迁移）：

```ts
buildFilters(input) {
  // 1. 先尝试 filter_mapping（manifest 声明式）
  const mapped = this.buildMappedFilters(input);
  if (mapped) return mapped;

  // 2. 再尝试 QueryAdapter（domain 注入）
  const adapter = this.queryAdapterRegistry?.resolve(input);
  if (adapter?.buildFilters) return adapter.buildFilters(input) ?? [];

  // 3. fallback：原有硬编码（逐步清空）
  return this.buildLegacyFilters(input);
}
```

`applyDefaults()` 和 `postProcessAnswer()` 同理。

改动文件：

```text
src/domains/query-adapter-registry.ts     新增
src/domains/attendance/query-adapter.ts   新增
src/domains/attendance/domain-pack.ts     补充 queryAdapters 字段
src/handlers/intent-query-handler.ts      接入 QueryAdapterRegistry，迁出 attendance 分支
src/app.ts                                注入 queryAdapterRegistry
```

验收：

```text
npm run build:ts
npm run eval:router           # 100/100
npm run eval:dealer           # 14/14（无回归）
# attendance 相关 eval（如有）
```

### Milestone 4b：DealerQueryAdapter

> **优先级**：P0
> **状态**：待开发
> **前置**：M4a 完成

目标：把 `IntentQueryHandler` 里的 dealer 业务特例全部迁出，handler 只保留 generic mapping fallback。

#### 4b-1：DealerQueryAdapter 实现

新增 `src/domains/dealer/query-adapter.ts`：

```text
迁移内容（从 intent-query-handler.ts 迁出）：
- dealer.query.inventory      buildFilters（~15 行）
- dealer.query.repair_orders  buildFilters（~28 行）
- dealer.query.warranty_claims buildFilters（~30 行）
- dealer.query.sales_orders   buildFilters（~50 行）
- dealer.query.leads          buildFilters（~28 行）
- dealer.query.finance        buildFilters（~30 行）
- dealer_metrics answer patch  postProcessAnswer（~3 行）
- default_store applyDefaults  applyDefaults（~8 行）
```

#### 4b-2：IntentQueryHandler 清理

迁移完成后，`buildFilters()` 中的 7 个 `if (intent_code === "...")` 分支全部删除，只保留：

```ts
buildFilters(input) {
  const mapped = this.buildMappedFilters(input);
  if (mapped) return mapped;

  const adapter = this.queryAdapterRegistry?.resolve(input);
  if (adapter?.buildFilters) return adapter.buildFilters(input) ?? [];

  return []; // generic fallback
}
```

`applyDefaults()` 中的 `default_store` 逻辑迁入 DealerQueryAdapter.applyDefaults()。

`execute()` 中的 `dealer_metrics` answer patch 迁入 DealerQueryAdapter.postProcessAnswer()。

#### 4b-3：intent-router.ts Extractor 去重

将 `intent-router.ts` 中 ~220 行重复 extractors（`tryShortCorrectionRoute` 使用）替换为从 domain extractor registry 引用：

```text
src/router/intent-router.ts    删除重复 extractors，import 域 extractors
```

改动文件：

```text
src/domains/dealer/query-adapter.ts       新增
src/domains/dealer/domain-pack.ts         补充 queryAdapters 字段
src/handlers/intent-query-handler.ts      删除所有 dealer 硬编码分支
src/router/intent-router.ts              去重 extractors
src/app.ts                                注入 dealer queryAdapter
```

验收：

```text
npm run build:ts
npm run eval:router           # 100/100
npm run eval:dealer           # 14/14
npm run eval:domain:retail-demo  # 13/13
```

### Milestone 4c：ExtractorSpec 声明式执行落地

> **优先级**：P1
> **状态**：待开发
> **前置**：M4b 完成

目标：让 `deterministic-rule-registry.ts` 中的 `string | ExtractorSpec` 路径真正执行，接口定义与实现对齐。

改动：

```text
src/router/deterministic-rule-registry.ts   补充 string / ExtractorSpec 分支执行逻辑
src/domains/types.ts                        确认 ExtractorSpec 类型完整
```

当前 `matchDomainRule()` 中 `rule.extractors` 只处理 `typeof extractor === "function"` 分支，`string` 和 `ExtractorSpec` 被注释跳过。需要补充：

```ts
if (typeof extractor === "string") {
  params[paramName] = runExtractor(extractor, text, extractorRegistry);
} else if (typeof extractor === "object" && extractor.use) {
  const val = runExtractor(extractor.use, text, extractorRegistry);
  params[paramName] = val ?? extractor.default ?? null;
}
```

验收：

```text
npm run build:ts
npm run eval:router           # 100/100
# 新增 ExtractorSpec 单元测试
```

### Milestone 5：Catalog + OpenUI Lang Domain Surface

> **优先级**：P2
> **状态**：待开发
> **前置**：M4b 完成

目标：让业务能力目录和业务 UI 都可由 domain 注册。

改动：

```text
src/tools/tool-catalog.ts                 接入 DomainRegistry.allCatalogDomains
src/domains/dealer/catalog-domains.ts     新增
src/domains/dealer/openui-surfaces.ts     新增
src/openui-lang/response.ts               接入 DomainRegistry.allSurfaceBuilders
```

验收：

```text
npm run eval:tool-catalog
npm run eval:tool-catalog-http
npm run openui:adapter
npm run openui:regression
```

### Milestone 6：文档和评测拆分

> **优先级**：P2
> **状态**：待开发
> **前置**：M5 完成

目标：让 runtime eval 和 domain eval 分离。

改动：

```text
docs/domain-pack-architecture.md    更新完成标准
README.md                           新增"如何新增业务域"指南
src/domains/dealer/eval/*           dealer 专属评测
package.json scripts                拆分 eval:runtime / eval:domain:*
```

验收：

```text
npm run eval:runtime
npm run eval:domain:dealer
npm run eval:domain:retail-demo
npm run regress:all
```

---

## 完成标准

本阶段完成后，应满足：

```text
1. dealer 是一个 DomainPack，而不是散落在 runtime core。                    ✅ M3 已达成
2. app.ts 不直接 import dealer 具体工具/规则/命令，只注册 domain pack。       ⬜ M3.5 目标
3. 新增一个 toy domain 不需要修改 router / handler / registry 核心。          ✅ M2.5 已验证
4. 新增一个 toy domain 不需要修改 app.ts 主体（只改 available-packs.ts）。    ⬜ M3.5 目标
5. IntentQueryHandler 不包含任何业务域特定的 if 分支。                        ⬜ M4b 目标
6. eval:router 仍保持 100/100。                                              ✅ 持续保持
7. ToolCatalog 能显示 domain 注册的分类。                                     ⬜ M5 目标
8. A2UI 能由 domain surface builder 生成业务面板。                            ⬜ M5 目标
9. README 能说明如何新增一个业务域。                                          ⬜ M6 目标
```

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
| createApp 同步→异步改造 | 调用方较多，改 async 影响面大 | 方案 A：返回 `{ app, init() }`，调用方显式 await init |
| QueryAdapter 迁移回归 | buildFilters 逻辑复杂，迁移易丢边界条件 | 每个 intent_code 迁移后立即跑对应 eval |

## 推荐下一步

当前处于 M3 完成、M3.5 待开发的阶段。建议按以下顺序推进：

```text
第一优先级（收口装配层）：
1. M3.5a：新增 available-packs.ts，app.ts 消除手工枚举
2. M3.5b：DomainRegistry.initialize() 激活，allDeterministicRules / allCommands 成为主路径
3. M3.5c：DomainPack 类型扩展 extractors / fieldLabels
4. M3.5d：business-tools.ts 旧配置降级

第二优先级（查询适配层）：
5. M4a：AttendanceQueryAdapter + QueryAdapterRegistry 基础设施
6. M4b：DealerQueryAdapter，清空 IntentQueryHandler 业务分支
7. M4c：ExtractorSpec 声明式执行落地

第三优先级（表现层 + 文档）：
8. M5：Catalog + A2UI Domain Surface
9. M6：文档和评测拆分
```

M3.5 + M4a/4b 完成后，解耦度预期从 ~45% 提升到 ~85%。M5 + M6 完成后达到 ~95%。

# OpenUI Lang 增量流式渲染改造设计

分支：`codex/openui-lang-integration`
作者：Tigertonight + Claude
日期：2026-05-23
状态：已迁移为 OpenUI Lang 主协议，A2UI v0.9 仅保留 wire compatibility

---

## 1. 背景

当前主协议为 **OpenUI Lang `openui-lang/1.0`**。增量 parser / streaming translator 的主实现位于 `src/openui-lang/streaming.ts`；`src/a2ui/*` 仅保留 legacy facade 名称，用于历史回放、旧客户端和 `/api/a2ui/*` 兼容路径。

迁移前，`src/a2ui/incremental-envelope-parser.ts` 名字叫 incremental，**实际只是一次性 batch 解析器**。整条旧链路是：

```
LLM 跑完 → orchestrator 出 result
        → chat-service.decorateChatResult (一次)
        → translator → adapter (583 行) 一次性产全量 envelopes
        → SSE 'done' 事件带回前端
        → 前端 materialize legacy envelope 全量 reduce 重建 surface
```

也就是说：**用户看到结构化卡片的时机 = 整个 agent 跑完的时机**。

中间 SSE 已经有 `agentic_event`（tool_call / lifecycle）、`delta`、`thinking` 等流，但这些都没参与 OpenUI Lang 渲染。

---

## 2. 目标

让 OpenUI Lang 真正"增量流式"：

- 工具一开始调用就先吐 skeleton 卡片框（loading 态）
- 工具返回了再 patch 数据
- 末端答案到位再补充 sources / runtime summary

体验目标：**用户在等待答案的过程中，UI 不再是空白，卡片骨架先出，数据逐步填充**。

非目标：

- 不重写 adapter.ts 现有的卡片产出逻辑（那 583 行另外一仗）
- 不引入 React/前端框架（继续保持原生 DOM）
- 对外主事件使用 `openui_*`；legacy `/api/chat/stream` 路径仍可输出 `a2ui_*`

---

## 3. 三层改造蓝图

### Level 1：parser 真 stateful

**文件**：`src/openui-lang/streaming.ts`（`src/a2ui/incremental-envelope-parser.ts` 只 re-export 旧名）

把旧无状态的 `parse(input): OpenUILangCompatEnvelope[]` 改造成：

```ts
class OpenUILangIncrementalEnvelopeParser {
  private surfaces = new Map<string, SurfaceState>();
  private dataModel = new Map<string, JsonValue>();

  ingest(envelopes: unknown[]): {
    accepted: OpenUILangCompatEnvelope[];   // 通过校验、被吸收的 compatibility envelope
    rejected: { envelope: unknown; reason: string }[];  // 容错：不抛异常，而是收集
    snapshot: SurfaceSnapshot[];  // 当前累积态
    acceptedOpenUIEvents: OpenUILangWireEvent[];
    document: OpenUILangDocument;
  };

  reset(): void;  // 新会话/新 runId 时清空
}
```

变更点：
- **从 `parse` → `ingest`**：方法名表达"逐步喂"
- **不抛 ValidationError**：流式场景里中间态不完整很正常，单条 envelope 不合法就丢进 `rejected`，不影响整体
- 新增 `snapshot()` 输出当前已累积的 surface 视图（前端可以选择全量 sync 而不是 diff）

**保留**：`parse()` 作为 `ingest + snapshot` 的薄包装，保持 batch 模式向后兼容（translator-service.ts 不改动）。

### Level 2：translator 流式 emit

**主实现**：`src/openui-lang/streaming.ts`（旧 `src/a2ui/streaming-translator.ts` 仅 re-export）

```ts
class OpenUILangStreamingTranslator {
  constructor(
    private readonly parser: OpenUILangIncrementalEnvelopeParser,
    private readonly emit: (event: OpenUILangWireEvent, document: OpenUILangDocument) => void
  ) {}

  // 把 agentic_event 翻译成 OpenUI Lang event / compatibility envelope（如果该事件有对应卡片）
  onAgenticEvent(event: AgenticEvent): void;

  // 末端 finalize：补 sources / runtime / vehicle_progress 等需要全量结果才能产的卡片
  finalize(result: AgentResult): OpenUILangWireEvent[];
}
```

事件 → envelope 映射（v1 只挑明确受益的）：

| Agentic 事件 | OpenUI Lang 行为 |
|---|---|
| `tool_call` (tool=`task.list` 等) | 立即 emit `createSurface` skeleton + 一个 placeholder component（loading 文案） |
| `tool_observation` 同 toolName | emit `updateDataModel` 填充结果 |
| `decided` lifecycle | 通常不发 OpenUI（仅 trace） |
| `answered` lifecycle | 触发 `finalize()` 出 sources/runtime 卡片 |

**不动 adapter.ts**：让 streaming-translator 持有 adapter 的"按 surface 类型生成 components"的子函数（需要把 adapter 内部那些 `vehicleProgressComponents`、`approvalComponents` 等导出来复用）。

### Level 3：前端 stateful merge + skeleton 渲染

**文件**：`src/server/chat-page.ts`

#### 3.1 SSE 协议扩展

主 SSE 事件：
```
event: openui_envelope
data: {"openui_event": {...}, "openui": {...}, "envelope": {...}}
```

后端 `OpenUILangChatController.streamOpenUI()` 在 `onEvent` 内 fork 一份给 streaming-translator，translator emit event 时立刻发该 SSE。legacy 路径可继续投影为 `a2ui_envelope`。

`done` 事件主字段为 OpenUI Lang document；`openui_compat` / `a2ui` 数组仅作为兜底、重连和旧前端 fallback。

#### 3.2 前端 stateful merge

```js
// 每个 message 加 openuiState，a2uiState 仅为 legacy alias
msg.openuiState = { surfaces: new Map(), dirty: true };

function applyOpenUILangEnvelope(msg, envelope) {
  // 增量 merge 进 msg.openuiState.surfaces
  // 标记 dirty，render() 时重新构建 DOM
}
```

`handleEvent` 里加分支：
```js
} else if (event === "openui_envelope" || event === "a2ui_envelope") {
  applyOpenUILangEnvelope(getMsg(assistantId), payload.envelope);
  render();
}
```

`flushPendingDone` 优先消费 OpenUI Lang document；`payload.openui_compat` / `payload.a2ui` 只作为兼容兜底：如果 `msg.openuiState.surfaces` 已经有内容，跳过；否则全量 reduce。

#### 3.3 Skeleton 渲染

`renderOpenUILangSurfaces` 加判断：surface 上若带 `data._skeleton: true` 标记，渲染 loading 骨架。Translator emit skeleton event/envelope 时打这个标记。

---

## 4. 文件改动清单

| 文件 | 改动 | 行数预估 |
|---|---|---|
| `src/openui-lang/streaming.ts` | stateful parser + streaming translator，旧 A2UI 文件 re-export | +300 |
| `src/openui-lang/response.ts` | OpenUI Lang surfaces → compatibility envelopes | +80 |
| `src/a2ui/adapter.ts` | 保留旧函数名，委托 OpenUI Lang builder | +10 / -0 |
| `src/openui-lang/module.ts` | `stream()` 注入 OpenUI Lang streaming translator；`src/a2ui/chat-controller.ts` 仅 legacy wrapper | +20 / -5 |
| `src/openui-lang/module.ts` | OpenUI Lang chat service 提供 streaming/action/history；`src/a2ui/chat-service.ts` 仅 legacy alias | +25 |
| `src/server/chat-page.ts` | 加 stateful merge + skeleton + SSE 分支 | +90 |
| `src/eval/openui-adapter.ts` | 兼容性测试：流式累积 = batch 结果 | +60 |

总计：约 +500 / -30 行。

---

## 5. 验收 checklist

### 后端
- [ ] `parser.ingest([])` 不抛异常
- [ ] 同一 surfaceId 多次 `updateComponents` 后 snapshot 包含合并后的 components
- [ ] 非法 envelope 进入 `rejected` 不污染 snapshot
- [ ] streaming-translator 收到 `tool_call` 后 emit createSurface
- [ ] eval 测试：流式喂 envelope 序列 vs 一次性 batch，最终 snapshot 等价

### 前端
- [ ] 工具调用瞬间出现 skeleton 卡片
- [ ] 工具返回后卡片填充数据，不闪烁、不重建 DOM
- [ ] `done` 后没有重复卡片
- [ ] 没有 a2ui_envelope 事件的旧消息（历史/重放）能正确渲染（兼容路径）

### 体验
- [ ] 至少 3 个典型 query：vehicle_progress / approval / task_resume，肉眼看出"卡片提前出现"

---

## 6. 风险

1. **adapter 内部函数耦合 result 全量**：现有 `extractVehicleProgress(record)` 等需要拿到 `record.output.*`，流式中间态没有完整 record。**对策**：v1 只对 `task.list` / `task.claim` 等"即时 tool 输出 = 卡片数据"的工具做 incremental，其他卡片仍走 finalize。

2. **前端 stateful merge 与 React-less 渲染冲突**：当前 `render()` 全量重绘消息列表。**对策**：增量 merge 数据结构，但渲染仍走全量 —— 性能上可接受（消息条数 < 50），先不优化。

3. **eval 测试不稳定**：流式 envelope 顺序依赖事件顺序。**对策**：eval 用确定性 fixture 而非真跑 LLM。

4. **协议扩展破坏兼容**：新增 `a2ui_envelope` SSE 事件。**对策**：旧前端忽略未知事件即可，无破坏；后端 `done` 仍带全量 a2ui。

---

## 7. 分阶段交付

- **PR-1**（半天）：Level 1 parser stateful 重构 + 单元测试。可独立 review、可独立合。
- **PR-2**（半天）：Level 2 streaming-translator + chat-controller 接线 + adapter 子函数导出。
- **PR-3**（半天）：Level 3 前端 stateful merge + skeleton 渲染。

每个 PR 单独可回滚，整体不必一次性合。

---

## 8. 待你拍板的开放问题

1. **新建文件 vs 改 translator-service**：建 `streaming-translator.ts` 还是把现有 `translator-service.ts`（11 行）扩成 streaming 版？倾向新建，老的留作 batch fallback。
2. **skeleton 用 a2UI 标准字段还是 `data._skeleton` 私有约定**：v0.9 协议没有 skeleton 字段，私有约定最快。是否能接受？
3. **eval 测试集要不要扩**：当前 `src/eval/openui-adapter.ts` 已覆盖 batch 与流式兼容。流式 fixture 仍可继续扩展。

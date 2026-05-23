# a2UI 增量流式渲染 改造设计

分支：`codex/a2ui-integration`
作者：Tigertonight + Claude
日期：2026-05-23
状态：草案，待评审

---

## 1. 背景

`src/a2ui/incremental-envelope-parser.ts` 名字叫 incremental，**实际只是一次性 batch 解析器**。整条 a2UI 链路目前是：

```
LLM 跑完 → orchestrator 出 result
        → chat-service.decorateChatResult (一次)
        → translator → adapter (583 行) 一次性产全量 envelopes
        → SSE 'done' 事件带回前端
        → 前端 materializeA2UI 全量 reduce 重建 surface
```

也就是说：**用户看到 a2UI 卡片的时机 = 整个 agent 跑完的时机**。

中间 SSE 已经有 `agentic_event`（tool_call / lifecycle）、`delta`、`thinking` 等流，但这些都没参与 a2UI 渲染。

---

## 2. 目标

让 a2UI 真正"增量流式"：

- 工具一开始调用就先吐 skeleton 卡片框（loading 态）
- 工具返回了再 patch 数据
- 末端答案到位再补充 sources / runtime summary

体验目标：**用户在等待答案的过程中，UI 不再是空白，卡片骨架先出，数据逐步填充**。

非目标：

- 不重写 adapter.ts 现有的卡片产出逻辑（那 583 行另外一仗）
- 不引入 React/前端框架（继续保持原生 DOM）
- 不改 a2UI v0.9 协议本身

---

## 3. 三层改造蓝图

### Level 1：parser 真 stateful

**文件**：`src/a2ui/incremental-envelope-parser.ts`

把当前无状态的 `parse(input): A2UIEnvelope[]` 改造成：

```ts
class A2UIIncrementalEnvelopeParser {
  private surfaces = new Map<string, SurfaceState>();
  private dataModel = new Map<string, JsonValue>();

  ingest(envelopes: unknown[]): {
    accepted: A2UIEnvelope[];   // 通过校验、被吸收的
    rejected: { envelope: unknown; reason: string }[];  // 容错：不抛异常，而是收集
    snapshot: SurfaceSnapshot[];  // 当前累积态
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

**新增**：`src/a2ui/streaming-translator.ts`

```ts
class A2UIStreamingTranslator {
  constructor(
    private readonly parser: A2UIIncrementalEnvelopeParser,
    private readonly emit: (envelope: A2UIEnvelope) => void
  ) {}

  // 把 agentic_event 翻译成 a2UI envelope（如果该事件有对应卡片）
  onAgenticEvent(event: AgenticEvent): void;

  // 末端 finalize：补 sources / runtime / vehicle_progress 等需要全量结果才能产的卡片
  finalize(result: AgentResult): A2UIEnvelope[];
}
```

事件 → envelope 映射（v1 只挑明确受益的）：

| Agentic 事件 | a2UI 行为 |
|---|---|
| `tool_call` (tool=`task.list` 等) | 立即 emit `createSurface` skeleton + 一个 placeholder component（loading 文案） |
| `tool_observation` 同 toolName | emit `updateDataModel` 填充结果 |
| `decided` lifecycle | 不发 a2UI（仅 trace） |
| `answered` lifecycle | 触发 `finalize()` 出 sources/runtime 卡片 |

**不动 adapter.ts**：让 streaming-translator 持有 adapter 的"按 surface 类型生成 components"的子函数（需要把 adapter 内部那些 `vehicleProgressComponents`、`approvalComponents` 等导出来复用）。

### Level 3：前端 stateful merge + skeleton 渲染

**文件**：`src/server/chat-page.ts`

#### 3.1 SSE 协议扩展

新增 SSE 事件：
```
event: a2ui_envelope
data: {"envelope": {...}}
```

后端 `chat-controller.stream` 在 `onEvent` 内 fork 一份给 streaming-translator，translator emit envelope 时立刻发该 SSE。

`done` 事件继续带 `a2ui` 全量数组（兜底/重连/前端 fallback）。

#### 3.2 前端 stateful merge

```js
// 每个 message 加 a2uiState
msg.a2uiState = { surfaces: new Map(), dirty: true };

function applyA2UIEnvelope(msg, envelope) {
  // 增量 merge 进 msg.a2uiState.surfaces
  // 标记 dirty，render() 时重新构建 DOM
}
```

`handleEvent` 里加分支：
```js
} else if (event === "a2ui_envelope") {
  applyA2UIEnvelope(getMsg(assistantId), payload.envelope);
  render();
}
```

`flushPendingDone` 把 `payload.a2ui` 当兜底：如果 `msg.a2uiState.surfaces` 已经有内容，跳过；否则全量 reduce（保持现有行为）。

#### 3.3 Skeleton 渲染

`renderA2UISurfaces` 加判断：surface 上若带 `data._skeleton: true` 标记，渲染 loading 骨架（灰色占位条 + spinner）。Translator emit skeleton envelope 时打这个标记。

---

## 4. 文件改动清单

| 文件 | 改动 | 行数预估 |
|---|---|---|
| `src/a2ui/incremental-envelope-parser.ts` | 重写为 stateful，保留 `parse()` 兼容 | +120 / -25 |
| `src/a2ui/streaming-translator.ts` | 新建 | +180 |
| `src/a2ui/adapter.ts` | 导出几个内部 components 构造函数 | +10 / -0 |
| `src/a2ui/chat-controller.ts` | `stream()` 注入 streaming-translator | +20 / -5 |
| `src/a2ui/chat-service.ts` | 新增 `streamingFactory()` | +25 |
| `src/server/chat-page.ts` | 加 stateful merge + skeleton + SSE 分支 | +90 |
| `src/eval/a2ui-adapter.ts` | 兼容性测试：流式累积 = batch 结果 | +60 |

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
3. **eval 测试集要不要扩**：当前 `src/eval/a2ui-adapter.ts` 只测 batch。流式要不要新加一组 fixture？倾向加。

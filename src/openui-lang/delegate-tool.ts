import { INTENTS } from "../agent/ports.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { createOpenUILangGenerationPrompt } from "./generation-prompt.js";

export const OPENUI_LANG_DELEGATE_TOOL_NAME = "openui.lang.delegate";
export const A2UI_DELEGATE_TOOL_NAME = "a2ui.delegate";

export const DEFAULT_OPENUI_LANG_DELEGATE_DESCRIPTION =
  "由模型自主判断是否需要 OpenUI Lang：当回复内容适合结构化或可视化表达"
  + "（如列表、表格、卡片、指标、图标状态、风险看板、表单、进度、引用来源、操作按钮等）时，"
  + "不要自己输出 Markdown 文本，也不需要先把数据整理成 Markdown 再回答。"
  + "直接调用此工具，将输出委托给 OpenUI Lang 渲染引擎处理。"
  + "不得在调用前或调用后追加任何文字内容。"
  + "如果回复只是简单的一两句话，或结构化 UI 不会提升可读性，则无需调用，直接回复即可。";

/** Legacy export name retained for old callers and regression tests. */
export const DEFAULT_A2UI_DELEGATE_DESCRIPTION = DEFAULT_OPENUI_LANG_DELEGATE_DESCRIPTION;

export function createOpenUILangDelegateDescription(): string {
  return `${DEFAULT_OPENUI_LANG_DELEGATE_DESCRIPTION}\n\n${createOpenUILangGenerationPrompt()}`;
}

/** Legacy export name retained for old callers. */
export const createA2UIDelegateDescription = createOpenUILangDelegateDescription;

export function createOpenUILangDelegateTool(options: { description?: string; name?: string } = {}): ToolDefinition {
  const name = options.name ?? OPENUI_LANG_DELEGATE_TOOL_NAME;
  return {
    name,
    description: options.description ?? createOpenUILangDelegateDescription(),
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: []
    },
    metadata: {
      risk_level: "read",
      category: "openui",
      intents: [INTENTS.KNOWLEDGE_QA, INTENTS.DATA_QUERY, INTENTS.MIXED],
      openui_lang_delegate: true,
      a2ui_delegate: name === A2UI_DELEGATE_TOOL_NAME
    },
    execute: (_args: JsonObject = {}, context?: ToolExecutionContext) => ({
      ok: true,
      delegated: true,
      tool: name,
      protocol: "openui-lang/1.0",
      session_id: typeof context?.session_id === "string" ? context.session_id : undefined,
      run_id: typeof context?.run_id === "string" ? context.run_id : undefined
    })
  };
}

export function createA2UIDelegateTool(options: { description?: string; name?: string } = {}): ToolDefinition {
  return createOpenUILangDelegateTool({ ...options, name: options.name ?? A2UI_DELEGATE_TOOL_NAME });
}

export function isOpenUILangDelegateToolResult(value: unknown): boolean {
  const tool = Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as { tool?: unknown }).tool
    : undefined;
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { delegated?: unknown; tool?: unknown }).delegated === true
    && (tool === OPENUI_LANG_DELEGATE_TOOL_NAME || tool === A2UI_DELEGATE_TOOL_NAME);
}

/** Legacy export name retained for old callers. */
export const isA2UIDelegateToolResult = isOpenUILangDelegateToolResult;

import type { ExecutionClass, HandlerType, JsonObject, JsonValue } from "../types/agent-contracts.js";

/**
 * Handler 的静态能力声明，灵感来自 OpenClaw plugin manifest（先声明、后激活）。
 *
 * 设计原则（参考 docs/orchestrator-handler-hook-refactor-retrospective.md）：
 * - 旁路声明，不替换 router/orchestrator 的现有 dispatch 链
 * - 纯静态、零副作用、可序列化（JsonValue 兼容）
 * - 现有 intent-code manifest（data/intent-codes/*.json）描述"intent → handler"，
 *   handler manifest 反过来描述"handler 能干什么"，两者互补
 */
export interface HandlerManifest extends JsonObject {
  handler_type: HandlerType;
  execution_class: ExecutionClass;
  /** 中文短描述，给 debug 面板和 trace 用 */
  description: string;
  /**
   * 是否支持流式输出（runStream）。
   * 不支持流式的 handler 如果被流式调用，orchestrator 会做单次回放降级。
   */
  supports_streaming: boolean;
  /**
   * 此 handler 是否会主动调工具（即是否走 LLM tool-calling loop）。
   * intent_query 走确定性绑定，所以是 false；agentic 是 true。
   */
  uses_tool_loop: boolean;
  /**
   * 此 handler 接受哪些 intent_code。空数组表示"任意 intent，需要 router 别处判定"。
   * - intent_query: 取决于绑定到它的 IntentManifest，运行时动态决定，故为 []
   * - agentic: 兜底 handler，接受任意 intent，故为 []
   * - workflow: 当前只有 leave_request，写死方便 debug
   */
  accepts_intent_codes: string[];
  /**
   * 此 handler 已知会调用的 tool 名集合（仅元信息，不强约束）。
   * 用于 debug 视图、未来按 tool 维度做能力评分。
   */
  known_tool_refs: string[];
  /** 关键能力点，给运维/调试快速读懂用 */
  capabilities: {
    task_continuity?: boolean;
    knowledge_grounding?: boolean;
    skill_injection?: boolean;
    confirmation_required?: boolean;
  };
}

const AGENTIC: HandlerManifest = {
  handler_type: "agentic",
  execution_class: "autonomous_planning",
  description: "自主规划 + 工具循环，处理复杂、跨意图、需要多步推理的场景。",
  supports_streaming: true,
  uses_tool_loop: true,
  accepts_intent_codes: [],
  // 核心工具引用；域特定工具通过 DomainPack.tools 动态注册
  known_tool_refs: [
    "query_business_data",
  ],
  capabilities: {
    task_continuity: true,
    knowledge_grounding: true,
    skill_injection: true,
    confirmation_required: true
  }
};

const INTENT_QUERY: HandlerManifest = {
  handler_type: "intent_query",
  execution_class: "controlled_execution",
  description: "确定性意图查询，按 IntentManifest 绑定的工具直接执行，不走 LLM tool 选择。",
  supports_streaming: true,
  uses_tool_loop: false,
  accepts_intent_codes: [],
  known_tool_refs: ["query_business_data"],
  capabilities: {
    task_continuity: false,
    knowledge_grounding: false,
    skill_injection: false,
    confirmation_required: true
  }
};

const CHITCHAT: HandlerManifest = {
  handler_type: "chitchat",
  execution_class: "controlled_execution",
  description: "轻量寒暄/闲聊，不调用业务工具。",
  supports_streaming: true,
  uses_tool_loop: false,
  accepts_intent_codes: ["system.smalltalk", "general"],
  known_tool_refs: [],
  capabilities: {
    task_continuity: false,
    knowledge_grounding: false,
    skill_injection: false,
    confirmation_required: false
  }
};

const KNOWLEDGE_LOOKUP: HandlerManifest = {
  handler_type: "knowledge_lookup",
  execution_class: "controlled_execution",
  description: "知识库 RAG 检索回答政策/FAQ 类问题。",
  supports_streaming: true,
  uses_tool_loop: false,
  accepts_intent_codes: ["knowledge.policy_qa"],
  known_tool_refs: [],
  capabilities: {
    task_continuity: false,
    knowledge_grounding: true,
    skill_injection: false,
    confirmation_required: false
  }
};

const WORKFLOW: HandlerManifest = {
  handler_type: "workflow",
  execution_class: "controlled_execution",
  description: "结构化多步流程，比如请假申请、表单填写。状态机驱动，可中断恢复。",
  supports_streaming: true,
  uses_tool_loop: false,
  // 域特定 workflow intent codes 通过 DomainPack.register() 动态注册到 ScenarioRouter
  accepts_intent_codes: [],
  known_tool_refs: [],
  capabilities: {
    task_continuity: true,
    knowledge_grounding: false,
    skill_injection: false,
    confirmation_required: true
  }
};

const ALL_MANIFESTS: HandlerManifest[] = [AGENTIC, INTENT_QUERY, CHITCHAT, KNOWLEDGE_LOOKUP, WORKFLOW];
const BY_TYPE = new Map<HandlerType, HandlerManifest>(
  ALL_MANIFESTS.map((manifest) => [manifest.handler_type, manifest])
);

export class HandlerManifestRegistry {
  get(handlerType: HandlerType | string | undefined | null): HandlerManifest | null {
    if (!handlerType) return null;
    return BY_TYPE.get(handlerType as HandlerType) ?? null;
  }

  list(): HandlerManifest[] {
    return ALL_MANIFESTS.slice();
  }

  /** 给 debug 面板 / `inspect` 端点用 */
  describeAll(): JsonValue {
    return ALL_MANIFESTS.map((manifest) => ({ ...manifest }));
  }

  hasHandler(handlerType: string | undefined | null): boolean {
    return this.get(handlerType) !== null;
  }

  /** 反查：给定 intent_code，哪些 handler 显式声明接受它 */
  findHandlersAcceptingIntent(intentCode: string): HandlerManifest[] {
    return ALL_MANIFESTS.filter((manifest) => manifest.accepts_intent_codes.includes(intentCode));
  }
}

export const handlerManifestRegistry = new HandlerManifestRegistry();

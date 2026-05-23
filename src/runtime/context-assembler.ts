import type { JsonObject, JsonValue, UserContext } from "../types/agent-contracts.js";
import type { WorkspaceContext } from "./workspace-context.js";

export interface ContextBudget {
  maxChars: number;
  adminChars: number;
  memoryChars: number;
  taskChars: number;
  transcriptChars: number;
  toolChars: number;
}

export interface ContextAssemblyInput {
  user: UserContext;
  workspace: WorkspaceContext;
  message: string;
  enterpriseContext?: unknown;
  conversationContext?: unknown;
  budget?: Partial<ContextBudget>;
  tokenBudget?: number;
}

export type PromptAuthority = "assembled" | "preassembly_may_overflow";

/**
 * Context 生命周期阶段（参考 OpenClaw 的 ingest/assemble/afterTurn/compact/maintain）。
 *
 * 当前 ContextAssembler 把所有事都揉在一次 assemble() 里做，肉眼难分辨"这块字段
 * 是哪个阶段产生的"。先不重构 assembler，只在 hook payload 上做 stage 标注，
 * 让 transcript / debug 面板可以按阶段看：
 *   - ingest：来自外部数据源、本轮还未参与提示拼装的原始素材（admin / memory / tasks）
 *   - assemble：本轮提示拼装本身（runtime / conversation）
 *   - afterTurn：本轮回答之后才会写回的内容（暂未由 assembler 输出，留位）
 *
 * 该枚举仅用于元信息标注。
 */
export type ContextStage = "ingest" | "assemble" | "afterTurn";

const STAGE_BY_SECTION: Record<string, ContextStage> = {
  runtime: "assemble",
  admin: "ingest",
  memory: "ingest",
  tasks: "ingest",
  conversation: "assemble"
};

export interface ContextAssemblyResult extends JsonObject {
  context: JsonObject;
  budget: JsonObject;
  sections: JsonObject[];
  dropped: JsonObject[];
  estimated_tokens: number;
  prompt_authority: PromptAuthority;
  /** 按生命周期阶段聚合的字符占用，便于 hook 消费者按阶段做统计/告警。 */
  stages: JsonObject;
}

const DEFAULT_BUDGET: ContextBudget = {
  maxChars: 18000,
  adminChars: 4500,
  memoryChars: 4500,
  taskChars: 3000,
  transcriptChars: 2500,
  toolChars: 2500
};

export class ContextAssembler {
  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    const budget = { ...DEFAULT_BUDGET, ...(input.budget ?? {}) };
    const enterprise = toRecord(input.enterpriseContext);
    const conversation = toRecord(input.conversationContext);
    const sections: JsonObject[] = [];
    const dropped: JsonObject[] = [];

    const admin = trimSection("admin", normalizeJson(enterprise.admin ?? []), budget.adminChars, dropped);
    const memory = trimSection("memory", normalizeJson({
      user_memory: enterprise.user_memory ?? null,
      relevant: toRecord(enterprise.memory).relevant ?? []
    }), budget.memoryChars, dropped);
    const tasks = trimSection("tasks", normalizeJson(enterprise.tasks ?? {}), budget.taskChars, dropped);
    const transcript = trimSection("conversation", normalizeJson(conversation), budget.transcriptChars, dropped);
    const runtime = trimSection("runtime", normalizeJson({
      user: pickUser(input.user),
      workspace: enterprise.workspace ?? { user_id: input.workspace.user_id },
      policy: enterprise.policy ?? null,
      evolution: enterprise.evolution ?? null
    }), Math.max(1000, budget.maxChars - budget.adminChars - budget.memoryChars - budget.taskChars - budget.transcriptChars), dropped);

    sections.push(
      createSection("runtime", runtime, priority("runtime"), stageOf("runtime")),
      createSection("admin", admin, priority("admin"), stageOf("admin")),
      createSection("memory", memory, priority("memory"), stageOf("memory")),
      createSection("tasks", tasks, priority("tasks"), stageOf("tasks")),
      createSection("conversation", transcript, priority("conversation"), stageOf("conversation"))
    );

    const totalChars = sections.reduce((sum, section) => sum + Number(section.chars ?? 0), 0);
    if (totalChars > budget.maxChars) {
      let overflow = totalChars - budget.maxChars;
      for (const section of sections.sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0)).reverse()) {
        if (overflow <= 0) break;
        if (section.name === "runtime" || section.name === "admin") continue;
        const text = String(section.content ?? "");
        const cut = Math.min(overflow, Math.floor(text.length / 2));
        if (cut <= 0) continue;
        section.content = text.slice(0, Math.max(0, text.length - cut)) + "\n...(budget truncated)";
        section.chars = String(section.content).length;
        overflow -= cut;
        dropped.push({ section: String(section.name), reason: "global_budget", chars: cut });
      }
    }

    const usedChars = sections.reduce((sum, section) => sum + Number(section.chars ?? 0), 0);
    const preTrimChars = totalChars;
    const estimatedTokens = estimateTokensFromChars(usedChars);
    const preTrimEstimatedTokens = estimateTokensFromChars(preTrimChars);
    const promptAuthority: PromptAuthority = dropped.length > 0 ? "preassembly_may_overflow" : "assembled";
    const stages = summarizeStages(sections);

    return {
      context: {
        runtime: parseSection(runtime),
        admin: parseSection(admin),
        memory: parseSection(memory),
        tasks: parseSection(tasks),
        conversation: parseSection(transcript)
      },
      budget: {
        max_chars: budget.maxChars,
        used_chars: usedChars,
        pre_trim_chars: preTrimChars,
        token_budget: input.tokenBudget ?? null,
        estimated_tokens: estimatedTokens,
        pre_trim_estimated_tokens: preTrimEstimatedTokens,
        sections: sections.map(({ name, chars, priority, stage }) => ({ name, chars, priority, stage }))
      },
      sections,
      dropped,
      estimated_tokens: estimatedTokens,
      prompt_authority: promptAuthority,
      stages
    };
  }
}

/**
 * 粗估 token 数。中文 ~1.5 字符/token，英文 ~4 字符/token，混排取保守值 2 字符/token。
 * 当且仅当下游需要近似预算判断时使用，不替代真正的 tokenizer。
 */
function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 2);
}

function trimSection(name: string, value: JsonValue, maxChars: number, dropped: JsonObject[]): string {
  const raw = JSON.stringify(value, null, 2);
  if (raw.length <= maxChars) return raw;
  dropped.push({ section: name, reason: "section_budget", original_chars: raw.length, kept_chars: maxChars });
  return raw.slice(0, Math.max(0, maxChars - 24)) + "\n...(section truncated)";
}

function createSection(name: string, content: string, sectionPriority: number, stage: ContextStage): JsonObject {
  return { name, content, chars: content.length, priority: sectionPriority, stage };
}

function stageOf(sectionName: string): ContextStage {
  return STAGE_BY_SECTION[sectionName] ?? "assemble";
}

function summarizeStages(sections: JsonObject[]): JsonObject {
  const summary: Record<ContextStage, { sections: string[]; chars: number }> = {
    ingest: { sections: [], chars: 0 },
    assemble: { sections: [], chars: 0 },
    afterTurn: { sections: [], chars: 0 }
  };
  for (const section of sections) {
    const stage = (section.stage as ContextStage) ?? "assemble";
    summary[stage].sections.push(String(section.name ?? ""));
    summary[stage].chars += Number(section.chars ?? 0);
  }
  return summary as unknown as JsonObject;
}

function priority(name: string): number {
  const map: Record<string, number> = { runtime: 100, admin: 90, tasks: 80, memory: 70, conversation: 60 };
  return map[name] ?? 10;
}

function parseSection(text: string): JsonValue {
  try {
    return JSON.parse(text.replace(/\n\.\.\.\(section truncated\)$/, ""));
  } catch {
    return { text };
  }
}

function pickUser(user: UserContext): JsonObject {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    department: user.department,
    default_store: user.default_store,
    permissions: user.permissions ?? []
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

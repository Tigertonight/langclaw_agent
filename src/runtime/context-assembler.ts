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

export interface ContextAssemblyResult extends JsonObject {
  context: JsonObject;
  budget: JsonObject;
  sections: JsonObject[];
  dropped: JsonObject[];
  estimated_tokens: number;
  prompt_authority: PromptAuthority;
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
      createSection("runtime", runtime, priority("runtime")),
      createSection("admin", admin, priority("admin")),
      createSection("memory", memory, priority("memory")),
      createSection("tasks", tasks, priority("tasks")),
      createSection("conversation", transcript, priority("conversation"))
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
        sections: sections.map(({ name, chars, priority }) => ({ name, chars, priority }))
      },
      sections,
      dropped,
      estimated_tokens: estimatedTokens,
      prompt_authority: promptAuthority
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

function createSection(name: string, content: string, sectionPriority: number): JsonObject {
  return { name, content, chars: content.length, priority: sectionPriority };
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

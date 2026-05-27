import type { EvolutionDecision, MemoryAction, SkillAction, TaskAction } from "./types.js";

const DENIED_PATTERNS = [
  /不用管权限|忽略权限|绕过权限|查所有|全部客户|所有客户/,
  /修改.*(规则|权限|策略|tool|工具|system|soul|agent)/i,
  /以后.*(不用|不要).*(审批|授权|校验|权限)/,
  /记住.*(密码|密钥|secret|token|key|身份证|银行卡)/i
];

const MAX_ACTIONS = 8;
const MIN_CONFIDENCE = 0.55;

export interface GuardedDecision {
  decision: EvolutionDecision;
  rejected: string[];
}

export function guardEvolutionDecision(input: unknown): GuardedDecision {
  const raw = isObject(input) ? input : {};
  const shouldEvolve = raw.should_evolve === true;
  const rejected: string[] = [];
  const memoryActions = filterActions<MemoryAction>(raw.memory_actions, isAllowedMemoryAction, rejected);
  const taskActions = filterActions<TaskAction>(raw.task_actions, isAllowedTaskAction, rejected);
  const skillActions = filterActions<SkillAction>(raw.skill_actions, isAllowedSkillAction, rejected);
  const total = memoryActions.length + taskActions.length + skillActions.length;
  if (total > MAX_ACTIONS) {
    rejected.push(`too_many_actions:${total}`);
  }
  return {
    decision: {
      should_evolve: shouldEvolve && total > 0,
      confidence: toConfidence(raw.confidence),
      reason: typeof raw.reason === "string" ? raw.reason.slice(0, 500) : undefined,
      memory_actions: memoryActions.slice(0, MAX_ACTIONS),
      task_actions: taskActions.slice(0, Math.max(0, MAX_ACTIONS - memoryActions.length)),
      skill_actions: skillActions.slice(0, Math.max(0, MAX_ACTIONS - memoryActions.length - taskActions.length))
    },
    rejected
  };
}

function filterActions<T>(value: unknown, predicate: (item: unknown) => item is T, rejected: string[]): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (predicate(item)) out.push(item);
    else rejected.push("invalid_or_denied_action");
  }
  return out;
}

function isAllowedMemoryAction(value: unknown): value is MemoryAction {
  if (!isObject(value)) return false;
  if (!["upsert", "remove"].includes(String(value.op))) return false;
  if (!["preference", "fact", "procedure", "episode"].includes(String(value.type))) return false;
  if (typeof value.key !== "string" || !value.key.trim()) return false;
  if (value.op === "upsert" && typeof value.value !== "string") return false;
  if (!confidenceAllowed(value.confidence)) return false;
  return !isDenied(`${value.key}\n${value.value ?? ""}`);
}

function isAllowedTaskAction(value: unknown): value is TaskAction {
  if (!isObject(value)) return false;
  if (!["upsert", "complete", "archive", "remove"].includes(String(value.op))) return false;
  if (!confidenceAllowed(value.confidence)) return false;
  return !isDenied(JSON.stringify(value));
}

function isAllowedSkillAction(value: unknown): value is SkillAction {
  if (!isObject(value)) return false;
  if (value.op !== "preference") return false;
  if (typeof value.value !== "string" || !value.value.trim()) return false;
  if (!confidenceAllowed(value.confidence)) return false;
  return !isDenied(value.value);
}

function confidenceAllowed(value: unknown): boolean {
  const confidence = toConfidence(value);
  return confidence === undefined || confidence >= MIN_CONFIDENCE;
}

function toConfidence(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : undefined;
}

function isDenied(text: string): boolean {
  return DENIED_PATTERNS.some((pattern) => pattern.test(text));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

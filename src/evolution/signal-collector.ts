import type { EvolutionSessionTrace, EvolutionTraceTurn, EvolutionTurnInput } from "./types.js";

interface PendingSignal {
  input: EvolutionTurnInput;
  trace: EvolutionSessionTrace;
  timer?: ReturnType<typeof setTimeout>;
}

const INTERRUPTION_PATTERNS = [/先停/, /停止/, /取消/, /别继续/, /换个方向/, /不是这个/, /\bstop\b/i, /\bcancel\b/i, /\binterrupt\b/i];

export class SignalCollector {
  private readonly pending = new Map<string, PendingSignal>();
  private readonly debounceMs: number;
  private readonly maxTurns: number;
  private readonly onIdle: (input: EvolutionTurnInput) => Promise<void>;
  private readonly onSessionIdle?: (input: EvolutionTurnInput) => Promise<void> | void;

  constructor({
    debounceMs = readPositiveNumberEnv("EVOLUTION_DEBOUNCE_MS", 5 * 60 * 1000),
    maxTurns = readPositiveNumberEnv("EVOLUTION_TRACE_MAX_TURNS", 24),
    onIdle,
    onSessionIdle
  }: {
    debounceMs?: number;
    maxTurns?: number;
    onIdle: (input: EvolutionTurnInput) => Promise<void>;
    onSessionIdle?: (input: EvolutionTurnInput) => Promise<void> | void;
  }) {
    this.debounceMs = debounceMs;
    this.maxTurns = maxTurns;
    this.onIdle = onIdle;
    this.onSessionIdle = onSessionIdle;
  }

  collect(input: EvolutionTurnInput): void {
    const key = `${input.workspace.user_id}:${input.sessionId}`;
    const now = new Date().toISOString();
    const existing = this.pending.get(key);
    const trace = existing?.trace ?? { started_at: now, turns: [] };
    const previousTurn = trace.turns[trace.turns.length - 1];
    trace.updated_at = now;
    const turn = createTraceTurn(input, now);
    trace.turns = [...trace.turns, turn].slice(-this.maxTurns);
    trace.failures = [...(trace.failures ?? []), ...detectFailures(turn)].slice(-50);
    trace.interruptions = [...(trace.interruptions ?? []), ...detectInterruptions(turn, trace.turns)].slice(-50);
    trace.task_state_changes = [...(trace.task_state_changes ?? []), ...detectTaskStateChanges(previousTurn?.task_snapshot, turn.task_snapshot, now)].slice(-50);

    if (existing?.timer) clearTimeout(existing.timer);
    const pending: PendingSignal = {
      input: { ...input, sessionTrace: trace },
      trace
    };
    pending.timer = setTimeout(() => {
      this.pending.delete(key);
      const idleInput = {
        ...pending.input,
        trigger: "session_idle",
        sessionTrace: pending.trace
      } satisfies EvolutionTurnInput;
      void Promise.resolve(this.onSessionIdle?.(idleInput)).then(() => this.onIdle(idleInput));
    }, this.debounceMs);
    pending.timer.unref?.();
    this.pending.set(key, pending);
  }

  async flush(sessionKey?: string): Promise<void> {
    const entries = Array.from(this.pending.entries())
      .filter(([key]) => !sessionKey || key === sessionKey);
    for (const [key, pending] of entries) {
      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(key);
      const idleInput = {
        ...pending.input,
        trigger: "session_idle",
        sessionTrace: pending.trace
      } satisfies EvolutionTurnInput;
      await this.onSessionIdle?.(idleInput);
      await this.onIdle(idleInput);
    }
  }
}

function createTraceTurn(input: EvolutionTurnInput, at: string): EvolutionTraceTurn {
  return {
    at,
    user_message: input.message,
    assistant_answer: input.answer,
    route: input.route,
    tool_calls: input.toolPlan?.calls ?? [],
    tool_results: input.toolResults ?? [],
    agent_steps: input.agentSteps?.slice(-16) ?? [],
    task_snapshot: extractTaskSnapshot(input.enterpriseContext)
  };
}

function extractTaskSnapshot(context: unknown): unknown {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  return (context as { tasks?: unknown }).tasks ?? null;
}

function detectFailures(turn: EvolutionTraceTurn) {
  const failures = [];
  for (const result of turn.tool_results ?? []) {
    if (result?.ok === false || result?.error) {
      failures.push({
        at: turn.at,
        kind: "tool_failure",
        tool: result.tool ?? null,
        error: result.error ?? null,
        message: result.message ?? null
      });
    }
  }
  for (const step of turn.agent_steps ?? []) {
    if (step.status === "failed" || String(step.id ?? "").includes("error")) {
      failures.push({
        at: turn.at,
        kind: "agent_step_failure",
        step: step.id ?? step.type ?? null,
        detail: step.detail ?? step.message ?? null
      });
    }
  }
  return failures;
}

function detectInterruptions(turn: EvolutionTraceTurn, turns: EvolutionTraceTurn[]) {
  const events = [];
  if (INTERRUPTION_PATTERNS.some((pattern) => pattern.test(turn.user_message))) {
    events.push({
      at: turn.at,
      kind: "user_interruption",
      message: turn.user_message.slice(0, 300)
    });
  }
  const normalized = normalizeText(turn.user_message);
  const repeated = turns.slice(0, -1).filter((item) => normalizeText(item.user_message) === normalized);
  if (normalized && repeated.length) {
    events.push({
      at: turn.at,
      kind: "repeated_follow_up",
      count: repeated.length + 1,
      message: turn.user_message.slice(0, 300)
    });
  }
  return events;
}

function detectTaskStateChanges(previous: unknown, current: unknown, at: string) {
  const before = summarizeTasks(previous);
  const after = summarizeTasks(current);
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{
    at,
    kind: "task_snapshot_changed",
    before,
    after
  }];
}

function summarizeTasks(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const record = snapshot as { active?: unknown; relevant?: unknown };
  const list = Array.isArray(record.active) ? record.active : Array.isArray(record.relevant) ? record.relevant : [];
  return list.map((item) => {
    const task = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: stringifyOrNull(task.id),
      status: stringifyOrNull(task.status),
      next_action: stringifyOrNull(task.next_action),
      updated_at: stringifyOrNull(task.updated_at)
    };
  });
}

function stringifyOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

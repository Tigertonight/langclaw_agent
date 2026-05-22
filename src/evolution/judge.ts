import { applyPromptCache } from "../llm/prompt-cache.js";
import { summarizeWorkspaceContext } from "../runtime/workspace-context.js";
import type { EvolutionDecision, EvolutionTurnInput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 20000;

export class EvolutionJudge {
  async decide(input: EvolutionTurnInput): Promise<{ ok: true; decision: EvolutionDecision } | { ok: false; reason: string }> {
    const apiKey = process.env.EVOLUTION_LLM_API_KEY
      ?? process.env.LLM_DECISION_API_KEY
      ?? process.env.LLM_API_KEY
      ?? process.env.OPENAI_API_KEY;
    if (!apiKey) return { ok: false, reason: "judge_unavailable:no_api_key" };

    const baseUrl = (process.env.EVOLUTION_LLM_BASE_URL
      ?? process.env.LLM_DECISION_BASE_URL
      ?? process.env.LLM_BASE_URL
      ?? process.env.OPENAI_BASE_URL
      ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
    const model = process.env.EVOLUTION_LLM_MODEL
      ?? process.env.LLM_DECISION_MODEL
      ?? process.env.LLM_MODEL
      ?? process.env.OPENAI_MODEL
      ?? "MiniMax-M2.7";
    const timeoutMs = readPositiveNumberEnv("EVOLUTION_LLM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

    const body = {
      model,
      messages: [
        { role: "system", content: EVOLUTION_JUDGE_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(createJudgePayload(input)) }
      ],
      temperature: 0,
      stream: false,
      response_format: { type: "json_object" }
    };
    applyPromptCache(body, { baseUrl, model, scope: "evolution.judge" });

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(body)
      });
      if (!response.ok) return { ok: false, reason: `judge_unavailable:http_${response.status}` };
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content;
      if (!content) return { ok: false, reason: "judge_unavailable:empty_content" };
      return { ok: true, decision: parseDecision(content) };
    } catch (error) {
      return { ok: false, reason: `judge_unavailable:${error instanceof Error ? error.message : "unknown_error"}` };
    }
  }
}

function createJudgePayload(input: EvolutionTurnInput) {
  return {
    trigger: input.trigger,
    user: {
      id: input.user.id,
      name: input.user.name,
      role: input.user.role,
      department: input.user.department
    },
    workspace: summarizeWorkspaceContext(input.workspace),
    session_id: input.sessionId,
    current_turn: {
      user_message: input.message,
      assistant_answer: input.answer,
      route: input.route ?? null,
      tool_calls: input.toolPlan?.calls ?? [],
      tool_results: summarizeToolResults(input.toolResults ?? []),
      agent_steps: input.agentSteps?.slice(-8) ?? []
    },
    session_trace: {
      started_at: input.sessionTrace?.started_at ?? null,
      updated_at: input.sessionTrace?.updated_at ?? null,
      turns: input.sessionTrace?.turns?.slice(-24).map((turn) => ({
        at: turn.at,
        user_message: turn.user_message,
        assistant_answer: turn.assistant_answer,
        route: turn.route ?? null,
        tool_calls: turn.tool_calls ?? [],
        tool_results: summarizeToolResults(turn.tool_results ?? []),
        agent_steps: turn.agent_steps?.slice(-8) ?? [],
        task_snapshot: turn.task_snapshot ?? null
      })) ?? [],
      failures: input.sessionTrace?.failures ?? [],
      interruptions: input.sessionTrace?.interruptions ?? [],
      task_state_changes: input.sessionTrace?.task_state_changes ?? []
    },
    context: {
      conversation: input.conversationContext ?? null,
      enterprise: summarizeEnterpriseForJudge(input.enterpriseContext)
    },
    output_contract: {
      should_evolve: "boolean",
      confidence: "number 0..1",
      reason: "short string",
      memory_actions: [
        { op: "upsert|remove", type: "preference|fact|procedure|episode", key: "stable_snake_case", value: "string", confidence: 0.8 }
      ],
      task_actions: [
        { op: "upsert|complete|archive|remove", task_id: "stable id", title: "string", goal: "string", status: "active|waiting_user|completed|archived", known_facts: ["string"], open_questions: ["string"], next_action: "string", confidence: 0.8 }
      ],
      skill_actions: [
        { op: "preference", skill_id: "optional skill id", value: "string", confidence: 0.8 }
      ]
    }
  };
}

function parseDecision(content: string): EvolutionDecision {
  const parsed = JSON.parse(content) as Partial<EvolutionDecision>;
  return {
    should_evolve: parsed.should_evolve === true,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    memory_actions: Array.isArray(parsed.memory_actions) ? parsed.memory_actions : [],
    task_actions: Array.isArray(parsed.task_actions) ? parsed.task_actions : [],
    skill_actions: Array.isArray(parsed.skill_actions) ? parsed.skill_actions : []
  };
}

function summarizeToolResults(toolResults: Array<Record<string, unknown>>) {
  return toolResults.slice(-12).map((result) => ({
    ok: result.ok,
    tool: result.tool,
    error: result.error,
    message: result.message,
    data_preview: JSON.stringify(result.data ?? null).slice(0, 1200)
  }));
}

function summarizeEnterpriseForJudge(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    workspace: record.workspace,
    user_memory: record.user_memory,
    org_memory_items: Array.isArray((record.org_memory as { items?: unknown[] } | undefined)?.items)
      ? (record.org_memory as { items?: unknown[] }).items?.length
      : 0,
    policy: record.policy
  };
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const EVOLUTION_JUDGE_SYSTEM_PROMPT = [
  "You are an Evolution Judge for a single-user enterprise agent workspace.",
  "Decide whether the session trace contains durable user memory, long-running task state, or skill usage preferences worth saving.",
  "Prefer evidence that appears across the multi-turn trace: tool call outcomes, repeated user corrections, unresolved tasks, interruptions, failures, and task state changes.",
  "Use the model judgment directly. Do not rely on keyword rules. If nothing durable changed, return should_evolve=false.",
  "Only suggest user-scoped changes. Never modify admin policy, permissions, org memory, system prompts, tools, or global skills.",
  "Never store secrets, credentials, tokens, personal IDs, bank cards, or instructions to bypass permission checks.",
  "Prefer stable concise memory. Do not save ordinary one-off query results unless they update an ongoing task or durable user preference.",
  "Return only valid JSON matching the requested contract."
].join("\n");

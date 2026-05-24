import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPromptCache } from "../llm/prompt-cache.js";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { TaskStore, summarizeTask } from "../tasks/task-store.js";
import type { JsonObject } from "../types/agent-contracts.js";
import { EpisodeStore } from "./episode-store.js";
import { ConflictStore } from "../memory/conflict-store.js";
import { MemoryLearner } from "./memory-learner.js";
import { CompactBoundary } from "../context/compact-boundary.js";
import { TranscriptStore } from "../transcript/transcript-store.js";

const DEFAULT_TIMEOUT_MS = 30000;

interface CompactionResult extends JsonObject {
  ok: boolean;
  status: "applied" | "unavailable" | "rejected";
  reason?: string;
  mode?: "llm" | "local_strategy";
  summary_path?: string;
  memory_items_written?: number;
  compacted_episodes?: number;
  duplicates_merged?: number;
  conflicts_written?: number;
  confidence_decayed?: number;
}

interface LocalCompactionStats {
  memoryItemsWritten: number;
  duplicatesMerged: number;
  conflictsWritten: number;
  confidenceDecayed: number;
}

export class MemoryCompactor {
  private readonly memoryLearner: MemoryLearner;
  private readonly episodeStore: EpisodeStore;
  private readonly taskStore: TaskStore;
  private readonly conflictStore: ConflictStore;
  private readonly compactBoundary: CompactBoundary;

  constructor({
    memoryLearner = new MemoryLearner(),
    episodeStore = new EpisodeStore(),
    taskStore = new TaskStore(),
    conflictStore = new ConflictStore(),
    transcriptStore = new TranscriptStore()
  }: {
    memoryLearner?: MemoryLearner;
    episodeStore?: EpisodeStore;
    taskStore?: TaskStore;
    conflictStore?: ConflictStore;
    /** 注入 TranscriptStore，用于压缩后写 compact_boundary 事件 */
    transcriptStore?: TranscriptStore;
  } = {}) {
    this.memoryLearner = memoryLearner;
    this.episodeStore = episodeStore;
    this.taskStore = taskStore;
    this.conflictStore = conflictStore;
    this.compactBoundary = new CompactBoundary(transcriptStore);
  }

  async compact(
    workspace: WorkspaceContext,
    {
      episodeLimit = 80,
      dryRun = false,
      /** 提供 sessionId 时，压缩完成后在该会话 transcript 写 compact_boundary 事件 */
      sessionId
    }: { episodeLimit?: number; dryRun?: boolean; sessionId?: string } = {}
  ): Promise<CompactionResult> {
    const apiKey = process.env.EVOLUTION_LLM_API_KEY
      ?? process.env.LLM_DECISION_API_KEY
      ?? process.env.LLM_API_KEY
      ?? process.env.OPENAI_API_KEY;
    const rawCharsBefore = await this.estimateRawChars(workspace, episodeLimit);
    const localStats = await this.applyLocalStrategy(workspace, dryRun);

    if (!apiKey) {
      await this.writeLocalReport(workspace, localStats, dryRun ? "dry-run" : "applied");
      const result: CompactionResult = {
        ok: true,
        status: "applied",
        mode: "local_strategy",
        reason: "compactor_llm_unavailable_applied_local_strategy",
        summary_path: path.relative(workspace.root, this.reportPath(workspace)),
        memory_items_written: localStats.memoryItemsWritten,
        duplicates_merged: localStats.duplicatesMerged,
        conflicts_written: localStats.conflictsWritten,
        confidence_decayed: localStats.confidenceDecayed
      };
      // 非 dry-run 时写 compact_boundary 事件（fire-and-forget）
      if (!dryRun && sessionId) {
        this.writeCompactBoundary(workspace, sessionId, {
          covered_event_count: localStats.duplicatesMerged + localStats.memoryItemsWritten,
          original_chars: rawCharsBefore,
          saved_chars: Math.max(0, rawCharsBefore - Math.floor(rawCharsBefore * 0.8)),
          reason: result.reason ?? "local_strategy"
        }).catch(() => undefined);
      }
      return result;
    }

    const payload = await this.createPayload(workspace, episodeLimit);
    const decision = await callCompactionLlm(apiKey, payload);
    if (!isValidDecision(decision)) {
      return { ok: false, status: "rejected", reason: "invalid_compaction_decision" };
    }
    if (dryRun) {
      await this.writeReport(workspace, decision, "dry-run");
      return {
        ok: true,
        status: "applied",
        mode: "llm",
        reason: "dry_run",
        summary_path: path.relative(workspace.root, this.reportPath(workspace)),
        duplicates_merged: localStats.duplicatesMerged,
        conflicts_written: localStats.conflictsWritten,
        confidence_decayed: localStats.confidenceDecayed
      };
    }

    let memoryItemsWritten = 0;
    const memory = await this.memoryLearner.load(workspace);
    const nextItems = mergeCompactedMemory(memory.items ?? [], decision.memory_items);
    if (nextItems.length !== memory.items.length || JSON.stringify(nextItems) !== JSON.stringify(memory.items)) {
      memory.items = nextItems.slice(-120) as typeof memory.items;
      memory.updated_at = new Date().toISOString();
      await this.writeMemoryVersion(workspace, memory, "llm_compaction");
      await this.memoryLearner.save(workspace, memory);
      memoryItemsWritten = nextItems.length;
    }
    await this.writeReport(workspace, decision, "applied");
    for (const conflict of decision.contradictions ?? []) {
      await this.conflictStore.upsert(workspace, {
        key: conflict.key,
        description: conflict.description,
        resolution: conflict.resolution,
        status: conflict.resolution === "needs_user_confirmation" ? "needs_user_confirmation" : "open",
        source: "llm_compaction"
      });
    }
    const compactedEpisodes = await this.episodeStore.compact(workspace, Math.max(20, Math.floor(episodeLimit / 2)));
    const summaryPath = path.relative(workspace.root, this.reportPath(workspace));
    const result: CompactionResult = {
      ok: true,
      status: "applied",
      mode: "llm",
      reason: decision.reason,
      summary_path: summaryPath,
      memory_items_written: memoryItemsWritten,
      compacted_episodes: compactedEpisodes,
      duplicates_merged: localStats.duplicatesMerged,
      conflicts_written: localStats.conflictsWritten + (decision.contradictions ?? []).length,
      confidence_decayed: localStats.confidenceDecayed
    };
    // 写 compact_boundary 事件（fire-and-forget，失败不影响主流程）
    if (sessionId) {
      const charsAfter = JSON.stringify(nextItems).length;
      this.writeCompactBoundary(workspace, sessionId, {
        covered_event_count: compactedEpisodes + memoryItemsWritten,
        original_chars: rawCharsBefore,
        saved_chars: Math.max(0, rawCharsBefore - charsAfter),
        summary_ref: summaryPath,
        reason: decision.reason
      }).catch(() => undefined);
    }
    return result;
  }

  /** 异步写 compact_boundary transcript 事件（memory 类型） */
  private async writeCompactBoundary(
    workspace: WorkspaceContext,
    sessionId: string,
    info: { covered_event_count: number; original_chars: number; saved_chars: number; summary_ref?: string; reason?: string }
  ): Promise<void> {
    await this.compactBoundary.write(workspace, sessionId, {
      compact_type: "memory",
      session_id: sessionId,
      covered_event_count: info.covered_event_count,
      original_chars: info.original_chars,
      compacted_chars: Math.max(0, info.original_chars - info.saved_chars),
      saved_chars: info.saved_chars,
      summary_ref: info.summary_ref,
      reason: info.reason
    });
  }

  /** 估算当前 memory + episodes 的原始字符量（用于计算压缩 saved_chars） */
  private async estimateRawChars(workspace: WorkspaceContext, episodeLimit: number): Promise<number> {
    try {
      const memory = await this.memoryLearner.load(workspace);
      const episodes = await this.episodeStore.recent(workspace, episodeLimit);
      return JSON.stringify(memory.items ?? []).length + JSON.stringify(episodes).length;
    } catch {
      return 0;
    }
  }

  private async applyLocalStrategy(workspace: WorkspaceContext, dryRun: boolean): Promise<LocalCompactionStats> {
    const memory = await this.memoryLearner.load(workspace);
    const { items, stats, conflicts } = compactMemoryWithStrategy(memory.items ?? []);
    if (!dryRun) {
      for (const conflict of conflicts) {
        await this.conflictStore.upsert(workspace, {
          key: conflict.key,
          description: conflict.description,
          resolution: "needs_user_confirmation",
          status: "needs_user_confirmation",
          source: "local_compaction"
        });
      }
      if (JSON.stringify(items) !== JSON.stringify(memory.items ?? [])) {
        memory.items = items.slice(-120) as typeof memory.items;
        memory.updated_at = new Date().toISOString();
        await this.writeMemoryVersion(workspace, memory, "local_compaction");
        await this.memoryLearner.save(workspace, memory);
        stats.memoryItemsWritten = memory.items.length;
      }
    }
    stats.conflictsWritten = conflicts.length;
    return stats;
  }

  private async createPayload(workspace: WorkspaceContext, episodeLimit: number): Promise<JsonObject> {
    const memory = await this.memoryLearner.load(workspace);
    const episodes = await this.episodeStore.recent(workspace, episodeLimit);
    const tasks = (await this.taskStore.active(workspace, 20)).map(summarizeTask);
    return {
      workspace_user_id: workspace.user_id,
      current_memory: memory.items ?? [],
      recent_episodes: episodes,
      active_tasks: tasks,
      previous_summary: await readIfExists(this.reportPath(workspace), 8000),
      output_contract: {
        reason: "short explanation",
        summary_markdown: "durable compacted user/work/task learning summary",
        memory_items: [
          { key: "stable_snake_case", type: "preference|fact|procedure|episode", value: "string", confidence: 0.8, source: "llm_compaction" }
        ],
        contradictions: [
          { key: "memory key or topic", description: "what conflicts", resolution: "keep_latest|needs_user_confirmation|disable_old" }
        ],
        duplicate_keys: ["memory keys that were merged"]
      }
    };
  }

  private async writeReport(workspace: WorkspaceContext, decision: CompactionDecision, status: "applied" | "dry-run"): Promise<void> {
    const file = this.reportPath(workspace);
    await mkdir(path.dirname(file), { recursive: true });
    const body = [
      `# Memory Compaction`,
      ``,
      `- status: ${status}`,
      `- updated_at: ${new Date().toISOString()}`,
      `- reason: ${decision.reason}`,
      ``,
      decision.summary_markdown.trim(),
      ``,
      `## Contradictions`,
      ...(decision.contradictions ?? []).map((item) => `- ${item.key}: ${item.description} (${item.resolution})`),
      ``,
      `## Duplicate Keys`,
      ...(decision.duplicate_keys ?? []).map((key) => `- ${key}`)
    ].join("\n");
    await writeFile(file, body.trim() + "\n", "utf8");
  }

  private async writeLocalReport(workspace: WorkspaceContext, stats: LocalCompactionStats, status: "applied" | "dry-run"): Promise<void> {
    const file = this.reportPath(workspace);
    await mkdir(path.dirname(file), { recursive: true });
    const body = [
      `# Memory Compaction`,
      ``,
      `- status: ${status}`,
      `- mode: local_strategy`,
      `- updated_at: ${new Date().toISOString()}`,
      `- duplicates_merged: ${stats.duplicatesMerged}`,
      `- conflicts_written: ${stats.conflictsWritten}`,
      `- confidence_decayed: ${stats.confidenceDecayed}`,
      ``,
      `Local strategy applied deterministic memory maintenance: duplicate merge, contradiction surfacing, and confidence decay.`
    ].join("\n");
    await writeFile(file, body.trim() + "\n", "utf8");
  }

  private reportPath(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "memory", "compaction.md");
  }

  private async writeMemoryVersion(workspace: WorkspaceContext, memory: JsonObject, reason: string): Promise<void> {
    const dir = safeJoinWorkspace(workspace.root, "memory", "versions");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `memory.${Date.now()}.json`);
    await writeFile(file, JSON.stringify({
      reason,
      created_at: new Date().toISOString(),
      memory
    }, null, 2), "utf8");
  }
}

interface CompactionDecision {
  reason: string;
  summary_markdown: string;
  memory_items: Array<{
    key: string;
    type: "preference" | "fact" | "procedure" | "episode";
    value: string;
    confidence?: number;
    source?: string;
  }>;
  contradictions?: Array<{ key: string; description: string; resolution: string }>;
  duplicate_keys?: string[];
}

async function callCompactionLlm(apiKey: string, payload: JsonObject): Promise<unknown> {
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
  const body = {
    model,
    messages: [
      { role: "system", content: COMPACTION_PROMPT },
      { role: "user", content: JSON.stringify(payload) }
    ],
    temperature: 0,
    stream: false,
    response_format: { type: "json_object" }
  };
  applyPromptCache(body, { baseUrl, model, scope: "evolution.memory_compaction" });
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(readPositiveNumberEnv("EVOLUTION_LLM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)),
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`compaction_llm_http_${response.status}`);
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("compaction_llm_empty_content");
  return JSON.parse(content);
}

function isValidDecision(value: unknown): value is CompactionDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<CompactionDecision>;
  return typeof record.reason === "string"
    && typeof record.summary_markdown === "string"
    && Array.isArray(record.memory_items)
    && record.memory_items.every((item) => Boolean(item)
      && typeof item === "object"
      && typeof item.key === "string"
      && typeof item.value === "string"
      && ["preference", "fact", "procedure", "episode"].includes(String(item.type)));
}

function mergeCompactedMemory(existing: Array<Record<string, unknown>>, compacted: CompactionDecision["memory_items"]) {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of existing) {
    if (typeof item.key === "string") map.set(item.key, item);
  }
  const now = new Date().toISOString();
  for (const item of compacted) {
    map.set(item.key, {
      ...map.get(item.key),
      key: item.key,
      type: item.type,
      value: item.value.trim(),
      confidence: typeof item.confidence === "number" ? item.confidence : 0.75,
      source: item.source ?? "llm_compaction",
      updated_at: now,
      created_at: typeof map.get(item.key)?.created_at === "string" ? map.get(item.key)?.created_at as string : now,
      source_history: appendHistory(map.get(item.key)?.source_history, {
        source: item.source ?? "llm_compaction",
        confidence: typeof item.confidence === "number" ? item.confidence : 0.75,
        at: now
      })
    });
  }
  return Array.from(map.values()).filter((item) => typeof item.value === "string" && item.value.trim());
}

function compactMemoryWithStrategy(existing: Array<Record<string, unknown>>): {
  items: Array<Record<string, unknown>>;
  stats: LocalCompactionStats;
  conflicts: Array<{ key: string; description: string }>;
} {
  const stats: LocalCompactionStats = { memoryItemsWritten: 0, duplicatesMerged: 0, conflictsWritten: 0, confidenceDecayed: 0 };
  const conflicts: Array<{ key: string; description: string }> = [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of existing) {
    const key = typeof item.key === "string" ? item.key : "";
    if (!key) continue;
    const next = { ...item };
    const decayed = decayConfidence(next.confidence, next.updated_at ?? next.created_at);
    if (typeof decayed === "number" && decayed !== next.confidence) {
      next.confidence = decayed;
      stats.confidenceDecayed += 1;
    }
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, withLocalHistory(next));
      continue;
    }
    if (String(current.value ?? "").trim() !== String(next.value ?? "").trim()) {
      conflicts.push({
        key,
        description: `Memory key ${key} has competing values: "${String(current.value ?? "").slice(0, 160)}" vs "${String(next.value ?? "").slice(0, 160)}".`
      });
    }
    stats.duplicatesMerged += 1;
    byKey.set(key, chooseStrongerMemory(current, withLocalHistory(next)));
  }

  const bySignature = new Map<string, Record<string, unknown>>();
  for (const item of byKey.values()) {
    const signature = `${String(item.type ?? "")}:${String(item.value ?? "").trim().toLowerCase()}`;
    const current = bySignature.get(signature);
    if (!current) {
      bySignature.set(signature, item);
      continue;
    }
    stats.duplicatesMerged += 1;
    bySignature.set(signature, chooseStrongerMemory(current, item));
  }
  return {
    items: Array.from(bySignature.values()).filter((item) => String(item.value ?? "").trim()),
    stats,
    conflicts
  };
}

function chooseStrongerMemory(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const confidenceA = Number(a.confidence ?? 0);
  const confidenceB = Number(b.confidence ?? 0);
  if (confidenceA !== confidenceB) return confidenceB > confidenceA ? b : a;
  const timeA = Date.parse(String(a.updated_at ?? a.created_at ?? ""));
  const timeB = Date.parse(String(b.updated_at ?? b.created_at ?? ""));
  return (Number.isFinite(timeB) ? timeB : 0) >= (Number.isFinite(timeA) ? timeA : 0) ? b : a;
}

function withLocalHistory(item: Record<string, unknown>): Record<string, unknown> {
  return {
    ...item,
    source_history: appendHistory(item.source_history, {
      source: String(item.source ?? "local_compaction"),
      confidence: typeof item.confidence === "number" ? item.confidence : undefined,
      at: new Date().toISOString()
    })
  };
}

function appendHistory(existing: unknown, entry: JsonObject): JsonObject[] {
  const list = Array.isArray(existing) ? existing.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  return [...list, entry].slice(-20);
}

function decayConfidence(confidence: unknown, lastSeen: unknown): number | undefined {
  if (typeof confidence !== "number") return undefined;
  const ts = Date.parse(String(lastSeen ?? ""));
  if (!Number.isFinite(ts)) return confidence;
  const ageDays = (Date.now() - ts) / 86400000;
  if (ageDays <= 30) return confidence;
  return Math.max(0.2, Number((confidence * Math.pow(0.98, Math.floor(ageDays / 30))).toFixed(3)));
}

async function readIfExists(file: string, max: number): Promise<string> {
  if (!existsSync(file)) return "";
  return (await readFile(file, "utf8")).slice(0, max);
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const COMPACTION_PROMPT = [
  "You are an LLM-only memory compactor for a single-user agent workspace.",
  "Read current memory, recent episodes, and active tasks. Produce durable compacted user-scoped memory and a markdown summary.",
  "Do not invent facts. Do not store secrets, credentials, permissions bypass instructions, or admin policy.",
  "Resolve duplicates by keeping the clearest stable item. For contradictions, report them instead of silently choosing unless the evidence is very clear.",
  "Return only valid JSON matching the output contract."
].join("\n");

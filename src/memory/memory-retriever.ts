import { EpisodeStore } from "../evolution/episode-store.js";
import { loadDisabledEvolutionTargets } from "../evolution/governance.js";
import { MemoryLearner } from "../evolution/memory-learner.js";
import { TaskStore, summarizeTask } from "../tasks/task-store.js";
import { TranscriptStore } from "../transcript/transcript-store.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";

export interface RetrievedMemory {
  source: "memory" | "episode" | "task" | "transcript";
  id: string;
  text: string;
  relevance: number;
  score_breakdown?: JsonObject;
  payload?: JsonObject;
}

export class MemoryRetriever {
  private readonly memoryLearner: MemoryLearner;
  private readonly episodeStore: EpisodeStore;
  private readonly taskStore: TaskStore;
  private readonly transcriptStore: TranscriptStore;

  constructor({
    memoryLearner = new MemoryLearner(),
    episodeStore = new EpisodeStore(),
    taskStore = new TaskStore(),
    transcriptStore = new TranscriptStore()
  }: {
    memoryLearner?: MemoryLearner;
    episodeStore?: EpisodeStore;
    taskStore?: TaskStore;
    transcriptStore?: TranscriptStore;
  } = {}) {
    this.memoryLearner = memoryLearner;
    this.episodeStore = episodeStore;
    this.taskStore = taskStore;
    this.transcriptStore = transcriptStore;
  }

  async retrieve(workspace: WorkspaceContext, query: string, { sessionId, limit = 12 }: { sessionId?: string; limit?: number } = {}): Promise<RetrievedMemory[]> {
    if (!query.trim()) return [];
    const disabled = await loadDisabledEvolutionTargets(workspace);
    const memory = await this.memoryLearner.load(workspace);
    const memoryItems: RetrievedMemory[] = memory.items
      .filter((item) => !disabled.has(item.key) && !disabled.has(`memory:${item.key}`))
      .map((item) => withScore({
        source: "memory",
        id: item.key,
        text: `${item.type}: ${item.value}`,
        payload: item
      }, query, { source: "memory" }));

    const episodes = (await this.episodeStore.recent(workspace, 60)).map((episode) => withScore({
      source: "episode" as const,
      id: String(episode.id ?? episode.at ?? "episode"),
      text: `${episode.user_message ?? ""}\n${episode.assistant_answer_preview ?? ""}\n${episode.result_reason ?? ""}`.trim(),
      payload: episode
    }, query, { source: "episode", at: typeof episode.at === "string" ? episode.at : undefined }));

    const tasks = (await this.taskStore.list(workspace)).map((task) => {
      const summary = summarizeTask(task);
      return {
        source: "task" as const,
        id: task.id,
        text: `${task.subject}\n${task.goal ?? ""}\n${task.next_action ?? ""}\n${task.open_questions.join("\n")}`,
        payload: summary
      };
    }).map((task) => withScore(task, query, { source: "task", at: typeof task.payload?.updated_at === "string" ? task.payload.updated_at : undefined }))
      .filter((task) => !disabled.has(task.id) && !disabled.has(`task:${task.id}`));

    const transcriptEvents = sessionId
      ? (await this.transcriptStore.recent(workspace, sessionId, 80)).map((event) => ({ ...event, relevance: scoreText(JSON.stringify(event.data), query).total }))
      : await this.transcriptStore.search(workspace, query, 40);
    const transcripts: RetrievedMemory[] = transcriptEvents.map((event) => withScore({
      source: "transcript",
      id: event.id,
      text: `${event.type}: ${JSON.stringify(event.data).slice(0, 1000)}`,
      payload: event
    }, query, { source: "transcript", at: event.at, sessionLocal: sessionId ? event.session_id === sessionId : false }));

    return [...memoryItems, ...episodes, ...tasks, ...transcripts]
      .filter((item) => item.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }
}

function withScore(item: Omit<RetrievedMemory, "relevance" | "score_breakdown">, query: string, options: { source: RetrievedMemory["source"]; at?: string; sessionLocal?: boolean }): RetrievedMemory {
  const textScore = scoreText(`${item.id}\n${item.text}\n${JSON.stringify(item.payload ?? {})}`, query);
  const sourceWeight = sourceWeightFor(options.source);
  const recencyBoost = recencyScore(options.at);
  const sessionBoost = options.sessionLocal ? 0.12 : 0;
  const total = Math.min(1, textScore.total * sourceWeight + recencyBoost + sessionBoost);
  return {
    ...item,
    relevance: Number(total.toFixed(4)),
    score_breakdown: {
      lexical: textScore.lexical,
      phrase: textScore.phrase,
      source_weight: sourceWeight,
      recency_boost: recencyBoost,
      session_boost: sessionBoost
    }
  };
}

function scoreText(text: string, query: string): { total: number; lexical: number; phrase: number } {
  const haystack = text.toLowerCase();
  const tokens = tokenize(query);
  if (!tokens.length) return { total: 0, lexical: 0, phrase: 0 };
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  const lexical = hits / tokens.length;
  const phrase = haystack.includes(String(query ?? "").trim().toLowerCase()) ? 0.25 : 0;
  return { total: Math.min(1, lexical + phrase), lexical, phrase };
}

function sourceWeightFor(source: RetrievedMemory["source"]): number {
  if (source === "task") return 1.25;
  if (source === "memory") return 1.15;
  if (source === "transcript") return 1.0;
  return 0.85;
}

function recencyScore(at?: string): number {
  const ts = Date.parse(String(at ?? ""));
  if (!Number.isFinite(ts)) return 0;
  const ageHours = (Date.now() - ts) / (60 * 60 * 1000);
  if (ageHours <= 1) return 0.12;
  if (ageHours <= 24) return 0.08;
  if (ageHours <= 24 * 7) return 0.04;
  return 0;
}

function tokenize(value: string): string[] {
  const raw = String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fa5]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const out = new Set(raw);
  for (const token of raw) {
    if (!/[\u4e00-\u9fa5]/u.test(token) || token.length <= 2) continue;
    for (let index = 0; index < token.length - 1; index += 1) out.add(token.slice(index, index + 2));
  }
  return Array.from(out).slice(0, 80);
}

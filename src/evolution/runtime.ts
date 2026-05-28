import { guardEvolutionDecision } from "./policy-guard.js";
import { EvolutionJudge } from "./judge.js";
import { MemoryLearner } from "./memory-learner.js";
import { SkillLearner } from "./skill-learner.js";
import { TaskLearner } from "./task-learner.js";
import { EpisodeStore } from "./episode-store.js";
import { SignalCollector } from "./signal-collector.js";
import { appendEvolutionLog } from "./log.js";
import { AutoCompactionTrigger } from "./auto-compaction.js";
import { EvolutionExtractor } from "./extractor.js";
import type { EvolutionResult, EvolutionTurnInput, MemoryAction } from "./types.js";

export class EvolutionRuntime {
  private readonly judge: EvolutionJudge;
  private readonly memoryLearner: MemoryLearner;
  private readonly taskLearner: TaskLearner;
  private readonly skillLearner: SkillLearner;
  private readonly episodeStore: EpisodeStore;
  private readonly signalCollector: SignalCollector;
  private readonly autoCompaction: AutoCompactionTrigger;
  private readonly extractor?: EvolutionExtractor;
  private readonly onReviewed?: (input: EvolutionTurnInput, result: EvolutionResult) => Promise<void> | void;

  constructor({
    judge = new EvolutionJudge(),
    memoryLearner = new MemoryLearner(),
    taskLearner = new TaskLearner(),
    skillLearner = new SkillLearner(),
    episodeStore = new EpisodeStore(),
    autoCompaction,
    extractor,
    debounceMs,
    onSessionIdle,
    onReviewed
  }: {
    judge?: EvolutionJudge;
    memoryLearner?: MemoryLearner;
    taskLearner?: TaskLearner;
    skillLearner?: SkillLearner;
    episodeStore?: EpisodeStore;
    autoCompaction?: AutoCompactionTrigger;
    /** Phase 2.5：传 EvolutionExtractor 实例即开启结构化抽取；省略则按 env 自动推断。 */
    extractor?: EvolutionExtractor | null;
    debounceMs?: number;
    onSessionIdle?: (input: EvolutionTurnInput) => Promise<void> | void;
    onReviewed?: (input: EvolutionTurnInput, result: EvolutionResult) => Promise<void> | void;
  } = {}) {
    this.judge = judge;
    this.memoryLearner = memoryLearner;
    this.taskLearner = taskLearner;
    this.skillLearner = skillLearner;
    this.episodeStore = episodeStore;
    this.autoCompaction = autoCompaction ?? new AutoCompactionTrigger({ memoryLearner });
    this.extractor = extractor === null ? undefined : (extractor ?? new EvolutionExtractor());
    this.onReviewed = onReviewed;
    this.signalCollector = new SignalCollector({
      debounceMs,
      onSessionIdle,
      onIdle: async (input) => {
        await this.reviewTurn(input);
      }
    });
  }

  collectTurn(input: EvolutionTurnInput): void {
    this.signalCollector.collect(input);
  }

  async flushSession(userId: string, sessionId: string): Promise<void> {
    await this.signalCollector.flush(`${userId}:${sessionId}`);
  }

  async reviewTurn(input: EvolutionTurnInput): Promise<EvolutionResult> {
    if (process.env.EVOLUTION_ENABLED === "0" || process.env.EVOLUTION_ENABLED === "false") {
      return this.finish(input, { status: "disabled", trigger: input.trigger, reason: "evolution_disabled" });
    }

    const judged = await this.judge.decide(input);
    if (judged.ok === false) {
      return this.finish(input, { status: "skipped", trigger: input.trigger, reason: judged.reason });
    }

    const guarded = guardEvolutionDecision(judged.decision);
    if (!guarded.decision.should_evolve) {
      return this.finish(input, {
        status: guarded.rejected.length ? "rejected" : "skipped",
        trigger: input.trigger,
        reason: guarded.decision.reason ?? "no_evolution_actions",
        decision: normalizeForLog(guarded.decision),
        errors: guarded.rejected
      });
    }

    // Phase 2.5：尝试结构化抽取；失败/禁用时回退到 Phase 1 plain memory_actions 路径。
    const extraction = await this.runExtraction(input);

    let memoryCount = 0;
    let entitiesWritten = 0;
    let relationsWritten = 0;
    const extractionErrors: string[] = [];

    if (extraction) {
      // 用结构化 extraction 覆盖 memory_actions（包含 judge 决议中的 actions 与 LLM 抽出的）。
      const merged = mergeMemoryActions(guarded.decision.memory_actions, extraction.memory_actions);
      const result = await this.memoryLearner.applyExtraction({
        workspace: input.workspace,
        user: input.user,
        extraction: { ...extraction, memory_actions: merged }
      });
      memoryCount = result.memory_changed;
      entitiesWritten = result.entities_written;
      relationsWritten = result.relations_written;
      extractionErrors.push(...result.errors);
    } else {
      memoryCount = await this.memoryLearner.apply({
        workspace: input.workspace,
        actions: guarded.decision.memory_actions,
        user: input.user
      });
    }

    const [taskCount, skillCount] = await Promise.all([
      this.taskLearner.apply({ workspace: input.workspace, actions: guarded.decision.task_actions }),
      this.skillLearner.apply({ workspace: input.workspace, actions: guarded.decision.skill_actions })
    ]);

    return this.finish(input, {
      status: "applied",
      trigger: input.trigger,
      reason: guarded.decision.reason,
      decision: normalizeForLog(guarded.decision),
      applied: {
        memory: memoryCount,
        tasks: taskCount,
        skills: skillCount,
        entities: entitiesWritten,
        relations: relationsWritten
      },
      errors: [...guarded.rejected, ...extractionErrors]
    });
  }

  private async runExtraction(input: EvolutionTurnInput) {
    if (!this.extractor) return null;
    try {
      const out = await this.extractor.extract(input);
      return out.ok ? out.data : null;
    } catch {
      return null;
    }
  }

  private async finish(input: EvolutionTurnInput, result: EvolutionResult): Promise<EvolutionResult> {
    await this.episodeStore.append(input, result);
    await this.episodeStore.compact(input.workspace);
    await appendEvolutionLog(input.workspace, {
      sessionId: input.sessionId,
      trigger: input.trigger,
      result
    });
    // 自动 compaction：根据 item 数量 + 冷却窗口决定是否触发，永不抛
    try {
      await this.autoCompaction.maybeRun(input.workspace);
    } catch {
      // maybeRun 内部已兜底，外层再吞一层防止任何异常打断 reviewTurn
    }
    await this.onReviewed?.(input, result);
    return result;
  }
}

function normalizeForLog(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function mergeMemoryActions(
  judgeActions: MemoryAction[] | undefined,
  extractionActions: MemoryAction[] | undefined
): MemoryAction[] {
  const out: MemoryAction[] = [];
  const seen = new Set<string>();
  for (const list of [judgeActions ?? [], extractionActions ?? []]) {
    for (const a of list) {
      const key = `${a.op}:${a.type}:${a.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
  }
  return out;
}

import { guardEvolutionDecision } from "./policy-guard.js";
import { EvolutionJudge } from "./judge.js";
import { MemoryLearner } from "./memory-learner.js";
import { SkillLearner } from "./skill-learner.js";
import { TaskLearner } from "./task-learner.js";
import { EpisodeStore } from "./episode-store.js";
import { SignalCollector } from "./signal-collector.js";
import { appendEvolutionLog } from "./log.js";
import type { EvolutionResult, EvolutionTurnInput } from "./types.js";

export class EvolutionRuntime {
  private readonly judge: EvolutionJudge;
  private readonly memoryLearner: MemoryLearner;
  private readonly taskLearner: TaskLearner;
  private readonly skillLearner: SkillLearner;
  private readonly episodeStore: EpisodeStore;
  private readonly signalCollector: SignalCollector;
  private readonly onReviewed?: (input: EvolutionTurnInput, result: EvolutionResult) => Promise<void> | void;

  constructor({
    judge = new EvolutionJudge(),
    memoryLearner = new MemoryLearner(),
    taskLearner = new TaskLearner(),
    skillLearner = new SkillLearner(),
    episodeStore = new EpisodeStore(),
    debounceMs,
    onSessionIdle,
    onReviewed
  }: {
    judge?: EvolutionJudge;
    memoryLearner?: MemoryLearner;
    taskLearner?: TaskLearner;
    skillLearner?: SkillLearner;
    episodeStore?: EpisodeStore;
    debounceMs?: number;
    onSessionIdle?: (input: EvolutionTurnInput) => Promise<void> | void;
    onReviewed?: (input: EvolutionTurnInput, result: EvolutionResult) => Promise<void> | void;
  } = {}) {
    this.judge = judge;
    this.memoryLearner = memoryLearner;
    this.taskLearner = taskLearner;
    this.skillLearner = skillLearner;
    this.episodeStore = episodeStore;
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

    const [memoryCount, taskCount, skillCount] = await Promise.all([
      this.memoryLearner.apply({ workspace: input.workspace, actions: guarded.decision.memory_actions }),
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
        skills: skillCount
      },
      errors: guarded.rejected
    });
  }

  private async finish(input: EvolutionTurnInput, result: EvolutionResult): Promise<EvolutionResult> {
    await this.episodeStore.append(input, result);
    await this.episodeStore.compact(input.workspace);
    await appendEvolutionLog(input.workspace, {
      sessionId: input.sessionId,
      trigger: input.trigger,
      result
    });
    await this.onReviewed?.(input, result);
    return result;
  }
}

function normalizeForLog(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

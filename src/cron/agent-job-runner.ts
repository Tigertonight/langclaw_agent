import { runAgent, renderToolListForPrompt, type AgentRunnerToolView, type AgentRunnerDecision } from "../agentic/agent-runner.js";
import type { AgenticHandler } from "../handlers/agentic-handler.js";
import { TaskStore } from "../tasks/task-store.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import {
  UserCronStore,
  PAUSE_THRESHOLD,
  type UserCronSpec,
  type CronHistoryEntry
} from "./user-cron-store.js";
import type { JsonObject, UserContext } from "../types/agent-contracts.js";

/**
 * AgentCronJobRunner —— 把 UserCronSpec 转成可执行的 cron job：到点就 spawn 一个隔离子 agent。
 *
 * 调用关系：
 *   - heartbeat 或 session_idle 触发器 → runner.runDue(workspace)
 *     → 扫所有 spec、computeDue、命中就 runOne(spec)
 *     → runOne 内部：mark running → runAgent → 写 history + state + landing
 *
 * landing（结果落地）：
 *   - history（必写）：append 一行到 .cron/history/<id>.jsonl
 *   - state（必写）：last_run_at / last_status / last_summary / consecutive_failures / paused
 *   - task（必写）：写一条 cron 类的 AgentTask，状态完成/失败，metadata 带 spec_id + summary
 *   - transcript（暂时只写 task 的 evidence 字段，不去碰 transcript-store；后续若 §3 gateway 来了再加 outbound）
 *
 * 防并发：runOne 入口先 mergeState({ running: true })；finally 块清 false。
 *   但要注意：写 state 是异步的，如果 heartbeat 间隔短于"running 标记落盘时间"，可能两个 tick 都没看到 running。
 *   实践上 heartbeat 通常 60s+，runner 落盘 < 100ms，竞态不显著；硬要严格可以加 file-lock，本期不做。
 */

export interface AgentCronJobRunnerOptions {
  handler: AgenticHandler;
  cronStore: UserCronStore;
  taskStore?: TaskStore;
  /** 让上游（test / gateway）注入：每次跑完调一下，用作 outbound 通知 hook。 */
  onAfterRun?: (entry: CronHistoryEntry, spec: UserCronSpec) => Promise<void> | void;
  /** 让 test 注入虚拟时间。生产用默认 () => new Date()。 */
  now?: () => Date;
}

export class AgentCronJobRunner {
  private readonly handler: AgenticHandler;
  private readonly cronStore: UserCronStore;
  private readonly taskStore: TaskStore;
  private readonly onAfterRun?: AgentCronJobRunnerOptions["onAfterRun"];
  private readonly now: () => Date;

  constructor(opts: AgentCronJobRunnerOptions) {
    this.handler = opts.handler;
    this.cronStore = opts.cronStore;
    this.taskStore = opts.taskStore ?? new TaskStore();
    this.onAfterRun = opts.onAfterRun;
    this.now = opts.now ?? (() => new Date());
  }

  /** 扫某个 workspace 的所有 spec，命中 due 就跑。返回每条 spec 的处置结果。 */
  async runDue(workspace: WorkspaceContext): Promise<Array<{ spec_id: string; ran: boolean; reason?: string; entry?: CronHistoryEntry }>> {
    const specs = await this.cronStore.list(workspace);
    const results: Array<{ spec_id: string; ran: boolean; reason?: string; entry?: CronHistoryEntry }> = [];
    for (const spec of specs) {
      const decision = this.cronStore.computeDue(spec, this.now());
      if (!decision.due) {
        results.push({ spec_id: spec.id, ran: false, reason: decision.reason });
        continue;
      }
      const entry = await this.runOne(workspace, spec);
      results.push({ spec_id: spec.id, ran: true, entry });
    }
    return results;
  }

  /** 单条 spec 触发执行。失败永远不抛——一律落到 history + state，避免污染 heartbeat。 */
  async runOne(workspace: WorkspaceContext, spec: UserCronSpec): Promise<CronHistoryEntry> {
    const startedAt = this.now();
    // 防并发：抢 running 标记
    const before = await this.cronStore.mergeState(workspace, spec.id, { running: true });
    if (!before) {
      const entry: CronHistoryEntry = {
        spec_id: spec.id,
        started_at: startedAt.toISOString(),
        finished_at: this.now().toISOString(),
        status: "failed",
        duration_ms: 0,
        summary: "spec 已不存在",
        error: "spec_not_found"
      };
      await this.cronStore.appendHistory(workspace, entry);
      return entry;
    }

    let entry: CronHistoryEntry;
    try {
      entry = await this.executeAgent(workspace, spec, startedAt);
    } catch (err) {
      // 兜底：runAgent 不应该抛（status 字段就是为此设计），但 ToolRegistry/Handler 万一抛我们也接住
      const message = err instanceof Error ? err.message : String(err);
      entry = {
        spec_id: spec.id,
        started_at: startedAt.toISOString(),
        finished_at: this.now().toISOString(),
        status: "failed",
        duration_ms: this.now().getTime() - startedAt.getTime(),
        summary: `cron 执行抛错：${message}`,
        error: message.slice(0, 500)
      };
    }

    // 写 state（last_run_at + 失败计数 + 自动暂停）
    const prevFailures = before.state?.consecutive_failures ?? 0;
    const consecutive = entry.status === "ok" ? 0 : prevFailures + 1;
    const paused = consecutive >= PAUSE_THRESHOLD;
    await this.cronStore.mergeState(workspace, spec.id, {
      running: false,
      last_run_at: entry.finished_at,
      last_status: entry.status,
      last_summary: entry.summary.slice(0, 500),
      consecutive_failures: consecutive,
      paused: paused || (before.state?.paused ?? false),
      last_seen_window: entry.finished_at
    });

    // history
    await this.cronStore.appendHistory(workspace, entry);

    // 落地一条 cron 任务（每次跑都建一个新 task，subject 带日期 + spec_id 便于检索）
    try {
      // failed 没有对应 TaskStatus，用 archived（cron 失败后任务关闭，下次跑会建新的）
      await this.taskStore.upsert(workspace, {
        owner: "agent",
        status: entry.status === "ok" ? "completed" : "archived",
        subject: `[cron] ${spec.task.slice(0, 60)}`,
        description: entry.summary,
        priority: "medium",
        metadata: {
          source: "cron",
          spec_id: spec.id,
          cron_expr: spec.cron_expr,
          started_at: entry.started_at,
          duration_ms: entry.duration_ms,
          iterations: entry.iterations ?? 0,
          tool_calls_count: entry.tool_calls_count ?? 0,
          paused_after_this: paused
        } as JsonObject
      });
    } catch {
      // task 落地失败不影响 history/state——cron 主流程已成功
    }

    if (this.onAfterRun) {
      try {
        await this.onAfterRun(entry, spec);
      } catch {
        // 通知 hook 失败不影响 cron 主流程
      }
    }

    return entry;
  }

  /** 真正调 runAgent 的内核。spec 已经 mark running，本函数专注业务。 */
  private async executeAgent(workspace: WorkspaceContext, spec: UserCronSpec, startedAt: Date): Promise<CronHistoryEntry> {
    const apiKey = process.env.LLM_DECISION_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const finishedAt = this.now();
      return {
        spec_id: spec.id,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        status: "failed",
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        summary: "缺 LLM_API_KEY，cron 无法跑 agent",
        error: "no_api_key"
      };
    }

    // 用 spec.user_id 重建用户上下文（避免误用调用方的）
    const user: UserContext = { id: spec.user_id, name: spec.user_id, role: "user", department: "" };
    const ws = workspace ?? resolveUserWorkspace(spec.user_id);

    // 工具白名单：取主 handler 全集，按 spec.allowed_tools 裁剪，移除 spawn_agent 防递归
    const fullToolset = this.handler.getAvailableTools({ user, workspace: ws });
    const allowed = spec.allowed_tools ? new Set(spec.allowed_tools) : null;
    const tools: AgentRunnerToolView[] = [];
    for (const tool of fullToolset) {
      if (tool.name === "agentic.spawn_agent") continue;
      if (allowed && !allowed.has(tool.name)) continue;
      tools.push({
        name: tool.name,
        description: tool.description,
        params_schema: tool.params_schema as Record<string, { type?: string; description?: string }> | undefined
      });
    }

    const systemPrompt = buildCronSystemPrompt({
      cronExpr: spec.cron_expr,
      toolListText: renderToolListForPrompt(tools)
    });

    const result = await runAgent({
      systemPrompt,
      userMessage: spec.task,
      tools,
      maxIterations: spec.max_steps ?? 5,
      totalTimeoutMs: spec.total_timeout_ms ?? 60_000,
      decide: async (conversation) => {
        const decision = await this.handler.decideNext({ conversation, apiKey });
        return decision as AgentRunnerDecision;
      },
      callTool: async (toolName, args) => {
        return this.handler.callTool({ callName: toolName, args, user, workspace: ws });
      }
    });

    const finishedAt = this.now();
    return {
      spec_id: spec.id,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      status: result.status === "answered" ? "ok" : "failed",
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      iterations: result.iterations,
      tool_calls_count: result.toolCalls.length,
      summary: result.summary.slice(0, 1000),
      ...(result.status !== "answered" && {
        error: result.lastError ?? result.status
      })
    };
  }
}

function buildCronSystemPrompt({ cronExpr, toolListText }: { cronExpr: string; toolListText: string }): string {
  return [
    "你是一个被 cron 触发的子 agent。没有真人在场——你的回答会被存到 task store 里给主人下次进来时看。",
    `本次触发由 cron 表达式『${cronExpr}』决定。任务由用户消息给出，独立完成。`,
    "",
    "可用工具（白名单内）：",
    toolListText,
    "",
    "工作流程：每轮严格输出 JSON：",
    `{
  "action": "tool_call" | "answer",
  "tool_name": "<当 action=tool_call 时填工具名>",
  "args": { ... },
  "tools": [{"tool_name": "<可选：相互独立的工具可一次返回多个>", "args": { ... }}],
  "answer": "<当 action=answer 时填最终结论>",
  "reason": "<一句话理由>"
}`,
    "",
    "硬规则：",
    "1. answer 控制在 300 字内，结构化（结论 + 关键证据 + 数据来源 + 异常）。",
    "2. 没有真人能即时回应你——遇到不确定就基于已有证据下结论，不要 ask_user。",
    "3. 工具失败也算证据，记到 answer 里。",
    "4. 步数预算紧，多步任务及时收敛。"
  ].join("\n");
}

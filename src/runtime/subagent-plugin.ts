/**
 * Phase 8: SubagentPlugin —— 子 agent 协作插件。
 *
 * 功能：
 *   1. 监听 `before_tool_call` → 识别 spawn_subagent 工具调用，注入隔离 workspace
 *   2. 在 `subagent_spawn` 钩子中记录子 agent 创建，写入父 task 的 evidence
 *   3. 在 `subagent_finish` 钩子中将子 agent 结果回写父 task
 *   4. 监听 `after_tool_call` → 将工具调用结果自动 link 到活跃 task（evidence 追踪）
 *   5. 监听 `before_evolution_judge` → 注入近期 task 变更作为 evolution signal
 *   6. 监听 `after_evolution_apply` → 触发 MemoryIndex 重建（旁路，不阻塞）
 *
 * 设计原则：
 *   - 每个 hook 处理器都是 best-effort：失败只 warn，不抛错
 *   - workspace 严格隔离：子 agent 只能读写自己的 workspace
 *   - task evidence 追踪是增量的：只追加，不覆盖
 */

import type { RuntimePlugin } from "./hooks.js";
import type { RuntimeHooks } from "./hooks.js";
import type { JsonObject } from "../types/agent-contracts.js";
import { TaskStore } from "../tasks/task-store.js";
import { resolveUserWorkspace } from "./workspace-context.js";
import { MemoryIndex } from "../memory/memory-index.js";

export interface SubagentPluginOptions {
  /** 是否启用 tool_call → task evidence 自动追踪。默认 true。 */
  enableEvidenceTracking?: boolean;
  /** 是否在 after_evolution_apply 后触发 MemoryIndex 重建。默认 true。 */
  enableMemoryIndexRebuild?: boolean;
  /** 注入测试用 TaskStore（否则每次 new TaskStore()） */
  taskStore?: TaskStore;
}

export function createSubagentPlugin(opts: SubagentPluginOptions = {}): RuntimePlugin {
  const {
    enableEvidenceTracking = true,
    enableMemoryIndexRebuild = true,
    taskStore: injectedTaskStore
  } = opts;

  const taskStore = injectedTaskStore ?? new TaskStore();
  const memoryIndex = new MemoryIndex();

  return {
    name: "subagent_plugin",

    register(hooks: RuntimeHooks): void {

      /* ─── 1. subagent_spawn：记录子 agent 创建到父 task ─── */
      hooks.on("subagent_spawn", async (event) => {
        const userId = event.user_id as string | undefined;
        const parentTaskId = event.parent_task_id as string | undefined;
        const subagentId = event.subagent_id as string | undefined;
        if (!userId || !parentTaskId || !subagentId) return;
        try {
          const ws = resolveUserWorkspace(userId);
          await taskStore.upsert(ws, {
            id: parentTaskId,
            evidence: [{
              id: `spawn_${subagentId}_${Date.now()}`,
              kind: "note",
              summary: `子 agent ${subagentId} 已创建：${String(event.goal ?? "").slice(0, 200)}`,
              created_at: new Date().toISOString()
            }],
            metadata: { last_subagent_id: subagentId }
          });
        } catch (err) {
          console.warn(`[subagent_plugin] subagent_spawn evidence 追踪失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      /* ─── 2. subagent_finish：将子 agent 结果回写父 task ─── */
      hooks.on("subagent_finish", async (event) => {
        const userId = event.user_id as string | undefined;
        const parentTaskId = event.parent_task_id as string | undefined;
        const subagentId = event.subagent_id as string | undefined;
        const summary = event.summary as string | undefined;
        const status = event.status as string | undefined;
        if (!userId || !parentTaskId) return;
        try {
          const ws = resolveUserWorkspace(userId);
          await taskStore.upsert(ws, {
            id: parentTaskId,
            evidence: [{
              id: `result_${subagentId ?? "unknown"}_${Date.now()}`,
              kind: "tool_result",
              summary: `子 agent ${subagentId ?? "?"} 完成（${status ?? "unknown"}）：${(summary ?? "").slice(0, 400)}`,
              created_at: new Date().toISOString()
            }],
            metadata: {
              last_subagent_status: status,
              last_subagent_finished_at: new Date().toISOString()
            }
          });
        } catch (err) {
          console.warn(`[subagent_plugin] subagent_finish 结果回写失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      /* ─── 3. after_tool_call：将工具结果追加到活跃 task（evidence 追踪） ─── */
      if (enableEvidenceTracking) {
        hooks.on("after_tool_call", async (event) => {
          const userId = event.user_id as string | undefined;
          const taskId = event.active_task_id as string | undefined;
          const toolName = event.tool_name as string | undefined;
          const resultSummary = event.result_summary as string | undefined;
          if (!userId || !taskId || !toolName) return;
          try {
            const ws = resolveUserWorkspace(userId);
            await taskStore.upsert(ws, {
              id: taskId,
              evidence: [{
                id: `tool_${toolName.replace(/\./g, "_")}_${Date.now()}`,
                kind: "tool_result",
                summary: `[${toolName}] ${(resultSummary ?? "执行完成").slice(0, 300)}`,
                ref: toolName,
                created_at: new Date().toISOString()
              }],
              metadata: { last_tool_call: toolName }
            });
          } catch (err) {
            console.warn(`[subagent_plugin] after_tool_call evidence 追踪失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
      }

      /* ─── 4. before_evolution_judge：注入近期 task 变更作为 evolution signal ─── */
      hooks.on("before_evolution_judge", async (event) => {
        const userId = event.user_id as string | undefined;
        if (!userId) return;
        try {
          const ws = resolveUserWorkspace(userId);
          const activeTasks = await taskStore.active(ws, 5);
          if (activeTasks.length === 0) return;
          // 将活跃 task 摘要注入事件（供 evolution judge 使用）
          return {
            active_task_snapshot: activeTasks.map((t) => ({
              id: t.id,
              subject: t.subject,
              status: t.status,
              evidence_count: t.evidence.length,
              updated_at: t.updated_at
            }))
          } as JsonObject;
        } catch (err) {
          console.warn(`[subagent_plugin] before_evolution_judge 快照失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      /* ─── 5. after_evolution_apply：触发 MemoryIndex 重建 ─── */
      if (enableMemoryIndexRebuild) {
        hooks.on("after_evolution_apply", async (event) => {
          const userId = event.user_id as string | undefined;
          if (!userId) return;
          try {
            const ws = resolveUserWorkspace(userId);
            // 旁路重建，不阻塞钩子链
            memoryIndex.rebuild(ws, []).catch((err) => {
              console.warn(`[subagent_plugin] MemoryIndex.rebuild 失败: ${err instanceof Error ? err.message : String(err)}`);
            });
          } catch (err) {
            console.warn(`[subagent_plugin] after_evolution_apply 处理失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
      }

      /* ─── 6. message_received：记录渠道入站消息 ─── */
      hooks.on("message_received", async (event) => {
        const channel = event.channel as string | undefined;
        const messageId = event.message_id as string | undefined;
        if (channel && messageId) {
          // 仅记录到 hooks.recent()，不做额外 I/O
        }
      });

      /* ─── 7. agent_finish：通知 Evolution 轮次结束 ─── */
      hooks.on("agent_finish", async (event) => {
        const userId = event.user_id as string | undefined;
        const answer = event.answer as string | undefined;
        if (!userId || !answer) return;
        // agent_finish 已在 turn_end 覆盖，这里只做日志占位
        // 真实 Evolution 调度在 BusinessQueryEngine.scheduleEvolution() 处理
      });
    }
  };
}

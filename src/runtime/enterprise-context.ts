import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { createRuntimeClockSnapshot } from "./runtime-clock.js";
import { resolveUserWorkspace, safeJoinWorkspace, summarizeWorkspaceContext, type WorkspaceContext } from "./workspace-context.js";
import { TaskStore, summarizeTask } from "../tasks/task-store.js";
import { TaskRetriever } from "../tasks/task-retriever.js";
import { loadDisabledEvolutionTargets } from "../evolution/governance.js";
import { MemoryRetriever } from "../memory/memory-retriever.js";
import type { JsonObject, UserContext } from "../types/agent-contracts.js";

const ADMIN_FILES = ["AGENTS.md", "SOUL.md", "TOOLS.md", "POLICY.md"];

export class EnterpriseContextProvider {
  private readonly workspaceDir: string;
  private readonly memoryDir: string;
  private readonly taskStore: TaskStore;
  private readonly taskRetriever: TaskRetriever;
  private readonly memoryRetriever: MemoryRetriever;

  constructor({ workspaceDir = "workspace" }: { workspaceDir?: string } = {}) {
    this.workspaceDir = resolveProjectPath(workspaceDir);
    this.memoryDir = path.join(this.workspaceDir, "memory");
    this.taskStore = new TaskStore();
    this.taskRetriever = new TaskRetriever({ taskStore: this.taskStore });
    this.memoryRetriever = new MemoryRetriever({ taskStore: this.taskStore });
  }

  async load({ user, workspace = resolveUserWorkspace(user), message, sessionId }: { user: UserContext; workspace?: WorkspaceContext; message?: string; sessionId?: string }): Promise<unknown> {
    const admin = await this.loadAdminContext();
    const orgMemory = await this.loadOrgMemory();
    const userMemory = await this.loadUserMemory(user.id, workspace);
    const evolution = await this.loadEvolutionContext(workspace);
    const disabled = await loadDisabledEvolutionTargets(workspace);
    userMemory.items = userMemory.items.filter((item) => !disabled.has(item.key) && !disabled.has(`memory:${item.key}`));
    const activeTasks = await this.taskStore.active(workspace, 8);
    const relevantTasks = typeof message === "string" && message.trim()
      ? await this.taskRetriever.retrieve(workspace, message, 5)
      : [];
    const relevantMemory = typeof message === "string" && message.trim()
      ? await this.memoryRetriever.retrieve(workspace, message, { sessionId, limit: 12 })
      : [];
    return {
      runtime: createRuntimeClockSnapshot(),
      workspace: summarizeWorkspaceContext(workspace),
      admin,
      org_memory: orgMemory,
      user_memory: userMemory,
      memory: {
        relevant: relevantMemory,
        usage_grounding: {
          query: message ?? "",
          restored_memory_count: relevantMemory.filter((item) => item.source === "memory").length,
          restored_task_count: relevantMemory.filter((item) => item.source === "task").length,
          restored_transcript_count: relevantMemory.filter((item) => item.source === "transcript").length,
          restored_episode_count: relevantMemory.filter((item) => item.source === "episode").length,
          top_sources: relevantMemory.slice(0, 5).map((item) => ({
            source: item.source,
            id: item.id,
            relevance: item.relevance,
            reason: item.score_breakdown
          }))
        }
      },
      tasks: {
        active: activeTasks.map(summarizeTask).filter((task) => !disabled.has(String(task.id)) && !disabled.has(`task:${String(task.id)}`)),
        relevant: relevantTasks.filter((task) => !disabled.has(String(task.id)) && !disabled.has(`task:${String(task.id)}`))
      },
      evolution,
      policy: {
        admin_managed: true,
        ordinary_user_can_modify_admin_context: false,
        user_memory_write_policy: "llm_evolution_judge_only"
      }
    };
  }

  async loadAdminContext(): Promise<Array<{ name: string; path: string; content: string }>> {
    const entries: Array<{ name: string; path: string; content: string }> = [];
    for (const file of ADMIN_FILES) {
      const fullPath = path.join(this.workspaceDir, file);
      if (!existsSync(fullPath)) continue;
      entries.push({
        name: file,
        path: path.relative(resolveProjectPath(), fullPath),
        content: await readFile(fullPath, "utf8")
      });
    }
    return entries;
  }

  async loadOrgMemory(): Promise<JsonObject> {
    const file = path.join(this.memoryDir, "org.json");
    if (!existsSync(file)) return { items: [] };
    try {
      return JSON.parse(await readFile(file, "utf8")) as JsonObject;
    } catch {
      return { items: [] };
    }
  }

  async loadUserMemory(userId: string, workspace = resolveUserWorkspace(userId)): Promise<UserMemory> {
    const file = this.userMemoryPath(workspace);
    if (!existsSync(file)) {
      return {
        owner_user_id: userId,
        scope: "user",
        readonly_for_users: false,
        items: []
      };
    }
    try {
      return JSON.parse(await readFile(file, "utf8")) as UserMemory;
    } catch {
      return {
        owner_user_id: userId,
        scope: "user",
        readonly_for_users: false,
        items: []
      };
    }
  }

  userMemoryPath(workspace: WorkspaceContext): string {
    return path.join(workspace.memory_dir, "memory.json");
  }

  async loadEvolutionContext(workspace: WorkspaceContext): Promise<JsonObject> {
    const preferencesFile = safeJoinWorkspace(workspace.root, ".evolution", "preferences.md");
    const preferences = existsSync(preferencesFile)
      ? (await readFile(preferencesFile, "utf8")).slice(0, 6000)
      : "";
    return {
      preferences,
      skill_preferences_dir: ".evolution/skills",
      note: "User-scoped evolution context only. It cannot override admin policy or permissions."
    };
  }
}

interface UserMemoryItem extends JsonObject {
  key: string;
  type: string;
  value: string;
  confidence: number;
  source?: string;
  created_at?: string;
}

interface UserMemory extends JsonObject {
  owner_user_id: string;
  scope: "user";
  readonly_for_users: boolean;
  items: UserMemoryItem[];
  updated_at?: string;
}

import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import type { UserContext } from "../types/agent-contracts.js";

export interface WorkspaceContext {
  user_id: string;
  root: string;
  memory_dir: string;
  sessions_dir: string;
  artifacts_dir: string;
  skills_dir: string;
  sandboxes_dir: string;
  logs_dir: string;
}

export interface WorkspaceSummary {
  scope: "user";
  user_id: string;
  root: string;
  memory: true;
  sessions: true;
  artifacts: true;
  sandboxes: true;
  logs: true;
  skills: "reserved";
}

export function resolveUserWorkspace(user: Pick<UserContext, "id"> | string): WorkspaceContext {
  const userId = typeof user === "string" ? user : user.id;
  const safeId = safeUserId(userId || "anonymous");
  const root = resolveProjectPath("users", safeId, "workspace");
  return {
    user_id: safeId,
    root,
    memory_dir: safeJoinWorkspace(root, "memory"),
    sessions_dir: safeJoinWorkspace(root, "sessions"),
    artifacts_dir: safeJoinWorkspace(root, "artifacts"),
    skills_dir: safeJoinWorkspace(root, "skills"),
    sandboxes_dir: safeJoinWorkspace(root, "sandboxes"),
    logs_dir: safeJoinWorkspace(root, "logs")
  };
}

export function safeUserId(userId: unknown): string {
  const normalized = String(userId ?? "anonymous").trim() || "anonymous";
  return normalized.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export function safeJoinWorkspace(root: string, ...parts: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("workspace_path_escape");
  }
  return target;
}

export function summarizeWorkspaceContext(workspace: WorkspaceContext): WorkspaceSummary {
  return {
    scope: "user",
    user_id: workspace.user_id,
    root: path.relative(resolveProjectPath(), workspace.root),
    memory: true,
    sessions: true,
    artifacts: true,
    sandboxes: true,
    logs: true,
    skills: "reserved"
  };
}

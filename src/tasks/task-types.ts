import type { JsonObject } from "../types/agent-contracts.js";

export type TaskStatus = "pending" | "in_progress" | "waiting_user" | "blocked" | "completed" | "archived";
export type TaskOwner = "agent" | "user" | "system";
export type TaskPriority = "low" | "medium" | "high";

export interface TaskStep extends JsonObject {
  id: string;
  subject: string;
  status: TaskStatus;
  evidence_refs?: string[];
}

export interface TaskEvidence extends JsonObject {
  id: string;
  kind: "tool_result" | "artifact" | "memory" | "note";
  summary: string;
  ref?: string;
  created_at: string;
}

export interface AgentTask extends JsonObject {
  id: string;
  task_list_id: string;
  subject: string;
  description?: string;
  active_form?: string;
  owner: TaskOwner;
  status: TaskStatus;
  priority: TaskPriority;
  blocks: string[];
  blocked_by: string[];
  goal?: string;
  plan: TaskStep[];
  artifacts: string[];
  evidence: TaskEvidence[];
  open_questions: string[];
  next_action?: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface TaskUpsertInput {
  id?: string;
  task_list_id?: string;
  subject?: string;
  description?: string;
  active_form?: string;
  owner?: TaskOwner;
  status?: TaskStatus;
  priority?: TaskPriority;
  blocks?: string[];
  blocked_by?: string[];
  goal?: string;
  plan?: TaskStep[];
  artifacts?: string[];
  evidence?: TaskEvidence[];
  open_questions?: string[];
  next_action?: string;
  metadata?: JsonObject;
}

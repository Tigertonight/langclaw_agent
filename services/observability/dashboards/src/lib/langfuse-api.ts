/**
 * 前端调用层。所有请求走同源 /api/langfuse/* → 后端 server.mjs 注入 Basic auth 后转发。
 * SECRET_KEY 永远不进浏览器。
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export interface TraceObservation {
  id: string;
  name?: string;
  type?: string; // SPAN | GENERATION | EVENT
  startTime?: string;
  endTime?: string;
  input?: JsonValue;
  output?: JsonValue;
  metadata?: JsonValue;
  parentObservationId?: string | null;
  model?: string;
  usage?: JsonValue;
}

export interface TraceDetail {
  id: string;
  name?: string;
  timestamp?: string;
  input?: JsonValue;
  output?: JsonValue;
  tags?: string[];
  metadata?: JsonValue;
  observations?: TraceObservation[];
  scores?: Array<{ id: string; name: string; value: number; comment?: string | null }>;
}

export interface TraceListItem {
  id: string;
  name?: string;
  timestamp?: string;
  tags?: string[];
  userId?: string | null;
  sessionId?: string | null;
}

export interface ListTracesParams {
  tags?: string[];
  userId?: string;
  sessionId?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
  page?: number;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  if (r.status === 401) {
    throw new ApiError("unauthorized", 401);
  }
  if (!r.ok) {
    const text = await r.text();
    throw new ApiError(`${r.status} ${text.slice(0, 200)}`, r.status);
  }
  return (await r.json()) as T;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function login(secret: string): Promise<void> {
  await http("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ secret })
  });
}

export async function logout(): Promise<void> {
  await http("/api/auth/logout", { method: "POST" });
}

export async function whoami(): Promise<{ authenticated: boolean }> {
  try {
    return await http("/api/auth/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { authenticated: false };
    }
    throw e;
  }
}

export async function getTrace(traceId: string): Promise<TraceDetail> {
  return http(`/api/langfuse/traces/${encodeURIComponent(traceId)}`);
}

export async function listTraces(
  params: ListTracesParams = {}
): Promise<{ data: TraceListItem[]; meta?: JsonValue }> {
  const q = new URLSearchParams();
  if (params.tags) for (const t of params.tags) q.append("tags", t);
  if (params.userId) q.set("userId", params.userId);
  if (params.sessionId) q.set("sessionId", params.sessionId);
  if (params.fromTimestamp) q.set("fromTimestamp", params.fromTimestamp);
  if (params.toTimestamp) q.set("toTimestamp", params.toTimestamp);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.page) q.set("page", String(params.page));
  return http(`/api/langfuse/traces?${q.toString()}`);
}

export async function listScores(params: {
  fromTimestamp?: string;
  limit?: number;
}): Promise<{ data: Array<{ id: string; traceId: string; name: string; value: number }> }> {
  const q = new URLSearchParams();
  if (params.fromTimestamp) q.set("fromTimestamp", params.fromTimestamp);
  if (params.limit) q.set("limit", String(params.limit));
  return http(`/api/langfuse/scores?${q.toString()}`);
}

import type { JsonObject } from "../types/agent-contracts.js";

export interface A2UIChatRequestDto extends JsonObject {
  user_id: string;
  message: string;
  session_id?: string;
  wecom_userid?: string;
  user_context?: JsonObject;
  debug?: boolean;
}

export interface A2UIActionRequestDto extends JsonObject {
  user_id: string;
  session_id?: string;
  action: JsonObject;
  metadata?: JsonObject;
}

export interface A2UISseEventDto extends JsonObject {
  type?: string;
}

export function parseA2UIChatRequest(body: Record<string, unknown>): A2UIChatRequestDto {
  if (typeof body.user_id !== "string" || typeof body.message !== "string") {
    throw new A2UIBadRequestError("user_id 和 message 必填。");
  }
  return {
    user_id: body.user_id,
    message: body.message,
    session_id: typeof body.session_id === "string" ? body.session_id : undefined,
    wecom_userid: typeof body.wecom_userid === "string" ? body.wecom_userid : undefined,
    user_context: isJsonObject(body.user_context) ? normalizeJsonObject(body.user_context) : undefined,
    debug: body.debug === true
  };
}

export function parseA2UIActionRequest(body: Record<string, unknown>): A2UIActionRequestDto {
  if (typeof body.user_id !== "string") throw new A2UIBadRequestError("user_id 必填。");
  return {
    user_id: body.user_id,
    session_id: typeof body.session_id === "string" ? body.session_id : undefined,
    action: isJsonObject(body.action) ? normalizeJsonObject(body.action) : {},
    metadata: isJsonObject(body.metadata) ? normalizeJsonObject(body.metadata) : undefined
  };
}

export class A2UIBadRequestError extends Error {
  code = "bad_request";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeJsonObject(value: unknown): JsonObject {
  const normalized = JSON.parse(JSON.stringify(value ?? {}));
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? normalized as JsonObject : {};
}

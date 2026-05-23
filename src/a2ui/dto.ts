import type { JsonObject } from "../types/agent-contracts.js";

export interface ClientCapabilitiesDto extends JsonObject {
  catalog_version?: string;
  supported_components?: string[];
}

export interface A2UIChatRequestDto extends JsonObject {
  user_id: string;
  message: string;
  session_id?: string;
  wecom_userid?: string;
  user_context?: JsonObject;
  debug?: boolean;
  client_capabilities?: ClientCapabilitiesDto;
}

export interface A2UIActionRequestDto extends JsonObject {
  user_id: string;
  session_id?: string;
  /** 客户端生成的 uuid，用于幂等去重；同一 (user, client_action_id) 在 60s 内只执行一次 */
  client_action_id?: string;
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
    debug: body.debug === true,
    client_capabilities: isJsonObject(body.client_capabilities) ? parseClientCapabilities(body.client_capabilities) : undefined
  };
}

export function parseA2UIActionRequest(body: Record<string, unknown>): A2UIActionRequestDto {
  if (typeof body.user_id !== "string") throw new A2UIBadRequestError("user_id 必填。");
  const clientActionId = typeof body.client_action_id === "string" ? body.client_action_id : undefined;
  if (clientActionId && !/^[A-Za-z0-9_.\-:]{1,128}$/.test(clientActionId)) {
    throw new A2UIBadRequestError("client_action_id 格式不合法。");
  }
  return {
    user_id: body.user_id,
    session_id: typeof body.session_id === "string" ? body.session_id : undefined,
    client_action_id: clientActionId,
    action: isJsonObject(body.action) ? normalizeJsonObject(body.action) : {},
    metadata: isJsonObject(body.metadata) ? normalizeJsonObject(body.metadata) : undefined
  };
}

function parseClientCapabilities(raw: Record<string, unknown>): ClientCapabilitiesDto {
  const supported = Array.isArray(raw.supported_components)
    ? raw.supported_components.filter((v): v is string => typeof v === "string")
    : undefined;
  return {
    catalog_version: typeof raw.catalog_version === "string" ? raw.catalog_version : undefined,
    supported_components: supported
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

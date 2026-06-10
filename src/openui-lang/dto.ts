import type { JsonObject } from "../types/agent-contracts.js";

export interface OpenUILangClientCapabilitiesDto extends JsonObject {
  catalog_version?: string;
  supported_components?: string[];
}

export interface OpenUILangChatRequestDto extends JsonObject {
  user_id: string;
  message: string;
  session_id?: string;
  wecom_userid?: string;
  user_context?: JsonObject;
  debug?: boolean;
  client_capabilities?: OpenUILangClientCapabilitiesDto;
  attachment_ids?: string[];
}

export interface OpenUILangActionRequestDto extends JsonObject {
  user_id: string;
  session_id?: string;
  client_action_id?: string;
  action: JsonObject;
  metadata?: JsonObject;
}

export interface OpenUILangSseEventDto extends JsonObject {
  type?: string;
}

export function parseOpenUILangChatRequest(body: Record<string, unknown>): OpenUILangChatRequestDto {
  if (typeof body.user_id !== "string" || typeof body.message !== "string") {
    throw new OpenUILangBadRequestError("user_id 和 message 必填。");
  }
  const attachmentIds = Array.isArray(body.attachment_ids)
    ? body.attachment_ids.filter((value): value is string => typeof value === "string").slice(0, 5)
    : undefined;
  return {
    user_id: body.user_id,
    message: body.message,
    session_id: typeof body.session_id === "string" ? body.session_id : undefined,
    wecom_userid: typeof body.wecom_userid === "string" ? body.wecom_userid : undefined,
    user_context: isJsonObject(body.user_context) ? normalizeJsonObject(body.user_context) : undefined,
    debug: body.debug === true,
    client_capabilities: isJsonObject(body.client_capabilities) ? parseClientCapabilities(body.client_capabilities) : undefined,
    attachment_ids: attachmentIds
  };
}

export function parseOpenUILangActionRequest(body: Record<string, unknown>): OpenUILangActionRequestDto {
  if (typeof body.user_id !== "string") throw new OpenUILangBadRequestError("user_id 必填。");
  const clientActionId = typeof body.client_action_id === "string" ? body.client_action_id : undefined;
  if (clientActionId && !/^[A-Za-z0-9_.\-:]{1,128}$/.test(clientActionId)) {
    throw new OpenUILangBadRequestError("client_action_id 格式不合法。");
  }
  return {
    user_id: body.user_id,
    session_id: typeof body.session_id === "string" ? body.session_id : undefined,
    client_action_id: clientActionId,
    action: isJsonObject(body.action) ? normalizeJsonObject(body.action) : {},
    metadata: isJsonObject(body.metadata) ? normalizeJsonObject(body.metadata) : undefined
  };
}

export class OpenUILangBadRequestError extends Error {
  code = "bad_request";
}

function parseClientCapabilities(raw: Record<string, unknown>): OpenUILangClientCapabilitiesDto {
  const supported = Array.isArray(raw.supported_components)
    ? raw.supported_components.filter((value): value is string => typeof value === "string")
    : undefined;
  return {
    catalog_version: typeof raw.catalog_version === "string" ? raw.catalog_version : undefined,
    supported_components: supported
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeJsonObject(value: unknown): JsonObject {
  const normalized = JSON.parse(JSON.stringify(value ?? {}));
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? normalized as JsonObject : {};
}

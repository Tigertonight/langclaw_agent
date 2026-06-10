/**
 * Legacy A2UI chat-controller facade.
 *
 * OpenUI Lang owns the controller implementation. This wrapper preserves the
 * old response shape and legacy SSE event names for /api/a2ui and /api/chat
 * compatibility paths.
 */

import { OpenUILangChatController, type OpenUILangStreamOptions } from "../openui-lang/module.js";
import type { OpenUILangSseEventDto } from "../openui-lang/dto.js";
import type { JsonObject } from "../types/agent-contracts.js";

export type StreamOptions = OpenUILangStreamOptions;

export class A2UIChatController extends OpenUILangChatController {
  override async chat(body: Record<string, unknown>): Promise<JsonObject> {
    return toLegacyA2UIPayload(await this.chatLegacy(body));
  }

  override async stream(
    body: Record<string, unknown>,
    emit: (event: OpenUILangSseEventDto, sseId?: string) => void | Promise<void>,
    options: OpenUILangStreamOptions = {}
  ): Promise<void> {
    const legacyEmit = async (event: OpenUILangSseEventDto, sseId?: string) => {
      await emit(toLegacyA2UIPayload(event as JsonObject) as OpenUILangSseEventDto, sseId);
    };
    if (options.eventProtocol === "openui") {
      await super.stream(body, legacyEmit, options);
      return;
    }
    await super.stream(body, legacyEmit, { ...options, eventProtocol: "legacy" });
  }

  override async history(input: { userId: string; sessionId: string; runId?: string; sinceSeq?: number }): Promise<JsonObject> {
    return await super.history(input, { eventProtocol: "legacy" });
  }
}

function toLegacyA2UIPayload<T extends JsonObject>(payload: T): T {
  const record = { ...payload } as JsonObject;
  if (Array.isArray(record.a2ui)) record.openui = record.a2ui;
  else if (Array.isArray(record.openui_compat)) record.openui = record.openui_compat;
  return record as T;
}

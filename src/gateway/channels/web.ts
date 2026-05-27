/**
 * Phase 7: WebChannelAdapter —— HTTP/Web 渠道适配器。
 *
 * 支持来自 Web 前端（聊天界面）的请求。
 * payload 格式：{ user_id, message, session_id?, metadata? }
 */
import type { GatewayChannelAdapter, GatewayInbound, GatewayOutbound } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";

export interface WebChannelPayload {
  user_id?: string;
  message?: string;
  text?: string;
  session_id?: string;
  message_id?: string;
  metadata?: JsonObject;
}

export class WebChannelAdapter implements GatewayChannelAdapter {
  readonly channelName = "web";

  /**
   * deliver 钩子：Web 场景由 HTTP response 直接返回答案，
   * 不需要主动推送；可以注入一个 sink 供测试捕获。
   */
  private readonly deliverSink?: (outbound: GatewayOutbound) => Promise<void> | void;

  constructor(opts: { deliverSink?: (outbound: GatewayOutbound) => Promise<void> | void } = {}) {
    this.deliverSink = opts.deliverSink;
  }

  isAvailable(): boolean {
    // Web 渠道始终可用（无需外部凭证）
    return true;
  }

  normalize(rawPayload: unknown): GatewayInbound | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;
    const p = rawPayload as WebChannelPayload;
    const userId = (p.user_id ?? "").trim();
    const text = (p.message ?? p.text ?? "").trim();
    if (!userId || !text) return null;
    return {
      channel: "web",
      message_id: p.message_id ?? `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sender_id: userId,
      user_id: userId,
      text,
      session_id: p.session_id,
      received_at: new Date().toISOString(),
      raw: rawPayload as JsonObject,
      metadata: p.metadata
    };
  }

  async deliver(outbound: GatewayOutbound): Promise<{ ok: boolean; error?: string }> {
    // Web 渠道通过 HTTP response 返回，不需要主动推送
    // 可以注入 sink 供测试 / webhook 回调使用
    if (this.deliverSink) {
      try {
        await this.deliverSink(outbound);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { ok: true };
  }
}

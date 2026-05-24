/**
 * Phase 7: WebhookChannelAdapter —— 通用 Webhook 渠道适配器。
 *
 * 支持来自第三方系统的 Webhook 回调（如 PingCode / 钉钉 / 自定义系统）。
 * payload 格式：灵活，使用 payloadExtractor 函数归一化。
 *
 * 默认 extractor 期望：
 *   { user_id, text/message, message_id?, session_id?, metadata? }
 *
 * 投递方式：回调到 reply_url（如果 payload 携带）。
 *
 * 环境变量：
 *   WEBHOOK_SECRET —— 可选的 webhook 签名密钥（用于验证来源）
 */
import type { GatewayChannelAdapter, GatewayInbound, GatewayOutbound } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";

export type WebhookPayloadExtractor = (raw: unknown) => {
  user_id: string;
  text: string;
  message_id?: string;
  session_id?: string;
  reply_url?: string;
  metadata?: JsonObject;
} | null;

const defaultExtractor: WebhookPayloadExtractor = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const userId = String(p.user_id ?? p.sender_id ?? "").trim();
  const text = String(p.text ?? p.message ?? p.content ?? "").trim();
  if (!userId || !text) return null;
  return {
    user_id: userId,
    text,
    message_id: p.message_id ? String(p.message_id) : undefined,
    session_id: p.session_id ? String(p.session_id) : undefined,
    reply_url: p.reply_url ? String(p.reply_url) : undefined,
    metadata: typeof p.metadata === "object" && p.metadata ? p.metadata as JsonObject : undefined
  };
};

export class WebhookChannelAdapter implements GatewayChannelAdapter {
  readonly channelName: string;
  private readonly extractor: WebhookPayloadExtractor;
  private readonly secret: string;

  constructor(opts?: {
    channelName?: string;
    extractor?: WebhookPayloadExtractor;
    secret?: string;
  }) {
    this.channelName = opts?.channelName ?? "webhook";
    this.extractor = opts?.extractor ?? defaultExtractor;
    this.secret = opts?.secret ?? process.env.WEBHOOK_SECRET ?? "";
  }

  isAvailable(): boolean {
    // Webhook 渠道始终可用（secret 可选）
    return true;
  }

  normalize(rawPayload: unknown): GatewayInbound | null {
    const extracted = this.extractor(rawPayload);
    if (!extracted) return null;
    return {
      channel: this.channelName,
      message_id: extracted.message_id ?? `${this.channelName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sender_id: extracted.user_id,
      user_id: extracted.user_id,
      text: extracted.text,
      session_id: extracted.session_id,
      received_at: new Date().toISOString(),
      raw: rawPayload as JsonObject,
      metadata: {
        ...(extracted.metadata ?? {}),
        ...(extracted.reply_url ? { reply_url: extracted.reply_url } : {})
      }
    };
  }

  async deliver(outbound: GatewayOutbound): Promise<{ ok: boolean; error?: string }> {
    // 如果 metadata 里有 reply_url，POST 回去
    const replyUrl = outbound.a2ui?.reply_url as string | undefined
      ?? (outbound as unknown as Record<string, unknown>)?.reply_url as string | undefined;

    if (!replyUrl) {
      // 没有回调 URL，视为 fire-and-forget（调用方自行拿 GatewayProcessResult）
      return { ok: true };
    }

    try {
      const body: JsonObject = {
        text: outbound.text,
        user_id: outbound.user_id,
        message_id: outbound.inbound_message_id
      };
      if (outbound.a2ui) body.a2ui = outbound.a2ui;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.secret) headers["X-Webhook-Secret"] = this.secret;
      const resp = await fetch(replyUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
      });
      return resp.ok ? { ok: true } : { ok: false, error: `reply_http_${resp.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

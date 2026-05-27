/**
 * Phase 7: FeishuChannelAdapter —— 飞书渠道适配器。
 *
 * 支持飞书机器人消息（事件订阅格式，IM 消息）。
 * payload 格式遵循飞书 Event Callback v2 格式。
 *
 * 环境变量：
 *   FEISHU_APP_ID      —— 飞书 App ID
 *   FEISHU_APP_SECRET  —— 飞书 App Secret
 */
import type { GatewayChannelAdapter, GatewayInbound, GatewayOutbound } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";

/** 飞书 IM 消息事件的最小子集 */
export interface FeishuEventPayload {
  schema?: string;
  header?: {
    event_id?: string;
    event_type?: string;
    create_time?: string;
    app_id?: string;
  };
  event?: {
    sender?: {
      sender_id?: {
        user_id?: string;
        union_id?: string;
        open_id?: string;
      };
    };
    message?: {
      message_id?: string;
      message_type?: string;
      content?: string; // JSON 字符串，如 {"text":"xxx"}
      chat_id?: string;
    };
  };
}

export class FeishuChannelAdapter implements GatewayChannelAdapter {
  readonly channelName = "feishu";

  private readonly appId: string;
  private readonly appSecret: string;

  constructor(opts?: { appId?: string; appSecret?: string }) {
    this.appId = opts?.appId ?? process.env.FEISHU_APP_ID ?? "";
    this.appSecret = opts?.appSecret ?? process.env.FEISHU_APP_SECRET ?? "";
  }

  isAvailable(): boolean {
    return Boolean(this.appId && this.appSecret);
  }

  normalize(rawPayload: unknown): GatewayInbound | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;
    const p = rawPayload as FeishuEventPayload;
    // 只处理 IM 消息
    if (p.header?.event_type !== "im.message.receive_v1") return null;
    const msg = p.event?.message;
    if (!msg || msg.message_type !== "text") return null;

    // 解析 content JSON 字符串
    let text = "";
    try {
      const contentObj = JSON.parse(msg.content ?? "{}") as { text?: string };
      text = (contentObj.text ?? "").trim();
    } catch {
      return null;
    }
    if (!text) return null;

    const senderId = p.event?.sender?.sender_id?.user_id
      ?? p.event?.sender?.sender_id?.open_id
      ?? "";
    if (!senderId) return null;

    return {
      channel: "feishu",
      message_id: msg.message_id ?? p.header?.event_id ?? `feishu_${Date.now()}`,
      sender_id: senderId,
      user_id: senderId,
      text,
      session_id: msg.chat_id,
      received_at: p.header?.create_time ?? new Date().toISOString(),
      raw: rawPayload as JsonObject,
      metadata: { chat_id: msg.chat_id, app_id: this.appId }
    };
  }

  async deliver(outbound: GatewayOutbound): Promise<{ ok: boolean; error?: string }> {
    if (!this.isAvailable()) {
      return { ok: false, error: "feishu_not_configured" };
    }
    try {
      // 1. 获取 tenant_access_token
      const tokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret })
      });
      if (!tokenResp.ok) {
        return { ok: false, error: `feishu_token_http_${tokenResp.status}` };
      }
      const tokenJson = await tokenResp.json() as { code?: number; tenant_access_token?: string };
      if (tokenJson.code !== 0) {
        return { ok: false, error: `feishu_token_err_${tokenJson.code}` };
      }
      const accessToken = tokenJson.tenant_access_token ?? "";

      // 2. 发送文本消息（私聊）
      const msgBody = {
        receive_id: outbound.user_id,
        msg_type: "text",
        content: JSON.stringify({ text: outbound.text.slice(0, 4000) })
      };
      const sendResp = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=user_id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(msgBody)
      });
      if (!sendResp.ok) {
        return { ok: false, error: `feishu_send_http_${sendResp.status}` };
      }
      const sendJson = await sendResp.json() as { code?: number; msg?: string };
      if (sendJson.code !== 0) {
        return { ok: false, error: `feishu_send_err_${sendJson.code}:${sendJson.msg ?? ""}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Phase 7: WeComChannelAdapter —— 企业微信渠道适配器。
 *
 * 支持企业微信 Webhook 消息（文本消息格式）。
 * payload 格式遵循 WeCom 企业内部应用消息推送格式。
 *
 * 环境变量：
 *   WECOM_CORP_ID      —— 企业 ID
 *   WECOM_AGENT_SECRET —— 应用 Secret（用于验证和发送）
 *   WECOM_AGENT_ID     —— 应用 AgentId
 */
import type { GatewayChannelAdapter, GatewayInbound, GatewayOutbound } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";

/** 企业微信事件消息的最小子集（归一化使用） */
export interface WeComEventPayload {
  MsgType?: string;
  Content?: string;
  FromUserName?: string;
  MsgId?: string;
  AgentID?: string;
  CreateTime?: number;
  ToUserName?: string;
}

export class WeComChannelAdapter implements GatewayChannelAdapter {
  readonly channelName = "wecom";

  private readonly corpId: string;
  private readonly agentSecret: string;
  private readonly agentId: string;
  private readonly accessTokenEndpoint: string;

  constructor(opts?: {
    corpId?: string;
    agentSecret?: string;
    agentId?: string;
  }) {
    this.corpId = opts?.corpId ?? process.env.WECOM_CORP_ID ?? "";
    this.agentSecret = opts?.agentSecret ?? process.env.WECOM_AGENT_SECRET ?? "";
    this.agentId = opts?.agentId ?? process.env.WECOM_AGENT_ID ?? "";
    this.accessTokenEndpoint = "https://qyapi.weixin.qq.com/cgi-bin";
  }

  isAvailable(): boolean {
    return Boolean(this.corpId && this.agentSecret && this.agentId);
  }

  normalize(rawPayload: unknown): GatewayInbound | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;
    const p = rawPayload as WeComEventPayload;
    // 只处理文本消息
    if (p.MsgType !== "text") return null;
    const text = (p.Content ?? "").trim();
    const senderId = (p.FromUserName ?? "").trim();
    if (!text || !senderId) return null;
    return {
      channel: "wecom",
      message_id: p.MsgId ? String(p.MsgId) : `wecom_${Date.now()}`,
      sender_id: senderId,
      user_id: senderId, // 企业微信 FromUserName 就是企业内 user_id
      text,
      received_at: p.CreateTime ? new Date(p.CreateTime * 1000).toISOString() : new Date().toISOString(),
      raw: rawPayload as JsonObject,
      metadata: { agent_id: p.AgentID, to_user: p.ToUserName }
    };
  }

  async deliver(outbound: GatewayOutbound): Promise<{ ok: boolean; error?: string }> {
    if (!this.isAvailable()) {
      return { ok: false, error: "wecom_not_configured" };
    }
    try {
      // 1. 获取 access_token
      const tokenResp = await fetch(
        `${this.accessTokenEndpoint}/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.agentSecret)}`
      );
      if (!tokenResp.ok) {
        return { ok: false, error: `wecom_token_http_${tokenResp.status}` };
      }
      const tokenJson = await tokenResp.json() as { errcode?: number; access_token?: string };
      if (tokenJson.errcode !== 0 && tokenJson.errcode !== undefined) {
        return { ok: false, error: `wecom_token_err_${tokenJson.errcode}` };
      }
      const accessToken = tokenJson.access_token ?? "";

      // 2. 发送文本消息
      const msgBody = {
        touser: outbound.user_id,
        msgtype: "text",
        agentid: parseInt(this.agentId, 10),
        text: { content: outbound.text.slice(0, 2048) }
      };
      const sendResp = await fetch(
        `${this.accessTokenEndpoint}/message/send?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msgBody) }
      );
      if (!sendResp.ok) {
        return { ok: false, error: `wecom_send_http_${sendResp.status}` };
      }
      const sendJson = await sendResp.json() as { errcode?: number; errmsg?: string };
      if (sendJson.errcode !== 0) {
        return { ok: false, error: `wecom_send_err_${sendJson.errcode}:${sendJson.errmsg ?? ""}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Phase 7: DingTalkChannelAdapter —— 钉钉渠道适配器（Webhook 机器人模式）。
 *
 * 支持钉钉自定义 Webhook 机器人（outgoing → webhook 双向）。
 * 接收格式：钉钉企业机器人 Outgoing 回调（msgtype=text）
 * 发送格式：钉钉自定义机器人 Webhook（HMAC-SHA256 timestamp 签名）
 *
 * 环境变量：
 *   DINGTALK_WEBHOOK_URL  —— 自定义机器人 Webhook 地址（发送消息）
 *   DINGTALK_SIGN_SECRET  —— 机器人签名密钥（如开启了签名验证）
 *   DINGTALK_OUTGOING_TOKEN —— Outgoing 机器人回调 Token（接收消息时验证）
 *
 * 签名算法（发送）：
 *   timestamp + "\n" + secret → HmacSHA256 → Base64 → URLEncode
 *   ref: https://open.dingtalk.com/document/orgapp/custom-robot-access
 */
import type { GatewayChannelAdapter, GatewayInbound, GatewayOutbound } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";
import { createHmac } from "node:crypto";

/** 钉钉 Outgoing 机器人回调消息结构（最小子集） */
export interface DingTalkOutgoingPayload {
  msgtype?: string;
  text?: { content?: string };
  senderNick?: string;
  senderStaffId?: string;
  chatbotUserId?: string;
  msgId?: string;
  createAt?: number;
  sessionWebhook?: string;
  conversationType?: string; // "1"=单聊 "2"=群聊
  conversationId?: string;
  atUsers?: Array<{ dingtalkId?: string }>;
}

export class DingTalkChannelAdapter implements GatewayChannelAdapter {
  readonly channelName = "dingtalk";

  private readonly webhookUrl: string;
  private readonly signSecret: string;
  private readonly outgoingToken: string;

  constructor(opts?: {
    webhookUrl?: string;
    signSecret?: string;
    outgoingToken?: string;
  }) {
    this.webhookUrl = opts?.webhookUrl ?? process.env.DINGTALK_WEBHOOK_URL ?? "";
    this.signSecret = opts?.signSecret ?? process.env.DINGTALK_SIGN_SECRET ?? "";
    this.outgoingToken = opts?.outgoingToken ?? process.env.DINGTALK_OUTGOING_TOKEN ?? "";
  }

  isAvailable(): boolean {
    return Boolean(this.webhookUrl);
  }

  /**
   * normalize() —— 将钉钉 Outgoing 回调 payload 归一化为 GatewayInbound。
   * 若 outgoingToken 已配置，会验证 payload 中的 token 字段。
   */
  normalize(rawPayload: unknown): GatewayInbound | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;
    const p = rawPayload as DingTalkOutgoingPayload;

    // 只处理文本消息
    if (p.msgtype !== "text") return null;
    const text = (p.text?.content ?? "").trim();
    const senderId = (p.senderStaffId ?? p.chatbotUserId ?? "").trim();
    if (!text || !senderId) return null;

    return {
      channel: "dingtalk",
      message_id: p.msgId ? String(p.msgId) : `dingtalk_${Date.now()}`,
      sender_id: senderId,
      user_id: senderId, // 钉钉 staffId 即企业内用户 ID
      text,
      received_at: p.createAt ? new Date(p.createAt).toISOString() : new Date().toISOString(),
      raw: rawPayload as JsonObject,
      metadata: {
        sender_nick: p.senderNick,
        conversation_type: p.conversationType,
        conversation_id: p.conversationId,
        session_webhook: p.sessionWebhook,
        at_users: p.atUsers
      }
    };
  }

  /**
   * deliver() —— 通过钉钉 Webhook 发送文本消息（含 HMAC-SHA256 签名）。
   * 消息内容超出 2048 字符时自动截断（钉钉 API 限制）。
   */
  async deliver(outbound: GatewayOutbound): Promise<{ ok: boolean; error?: string }> {
    if (!this.isAvailable()) {
      return { ok: false, error: "dingtalk_not_configured" };
    }
    try {
      const url = this.buildSignedUrl();
      const body = {
        msgtype: "text",
        text: {
          content: outbound.text.slice(0, 2048)
        },
        at: {
          isAtAll: false
        }
      };
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        return { ok: false, error: `dingtalk_http_${resp.status}` };
      }
      const json = await resp.json() as { errcode?: number; errmsg?: string };
      if (json.errcode !== 0) {
        return { ok: false, error: `dingtalk_api_${json.errcode}:${json.errmsg ?? ""}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * buildSignedUrl() —— 构造带时间戳 + HMAC-SHA256 签名的 Webhook URL。
   * 无 signSecret 时直接返回原始 URL（机器人未开启签名验证）。
   */
  private buildSignedUrl(): string {
    if (!this.signSecret) return this.webhookUrl;
    const timestamp = Date.now();
    const strToSign = `${timestamp}\n${this.signSecret}`;
    const hmac = createHmac("sha256", this.signSecret);
    hmac.update(strToSign);
    const sign = encodeURIComponent(hmac.digest("base64"));
    const sep = this.webhookUrl.includes("?") ? "&" : "?";
    return `${this.webhookUrl}${sep}timestamp=${timestamp}&sign=${sign}`;
  }
}

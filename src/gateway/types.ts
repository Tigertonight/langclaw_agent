/**
 * Phase 7: Enterprise Gateway 类型定义
 *
 * 统一入口层（Web / WeCom / Feishu / Webhook / Cron）共享的消息契约。
 * 各 channel adapter 将渠道原始消息归一化为 GatewayInbound，
 * 交给 EnterpriseGateway 路由到 QueryEngine。
 */
import type { JsonObject } from "../types/agent-contracts.js";

/** 归一化的入站消息（来自任意渠道） */
export interface GatewayInbound {
  /** 渠道名称：web / wecom / feishu / webhook / cron */
  channel: string;
  /** 渠道内的消息 id（用于幂等、审计）。auto-generated 如果渠道不提供 */
  message_id: string;
  /** 发送者在渠道内的 id（如 wecom openid / feishu user_id） */
  sender_id: string;
  /** 解析后的平台用户 id（企业内部 user_id，可能与 sender_id 相同） */
  user_id: string;
  /** 消息正文（纯文本） */
  text: string;
  /** 渠道原始 payload，供 adapter 下游使用 */
  raw?: JsonObject;
  /** 消息接收时间 */
  received_at: string;
  /** 会话 id（如果渠道支持） */
  session_id?: string;
  /** 租户 id（多租户场景） */
  tenant_id?: string;
  /** 附加元数据 */
  metadata?: JsonObject;
}

/** Gateway 处理后的出站响应 */
export interface GatewayOutbound {
  /** 对应的入站 message_id */
  inbound_message_id: string;
  /** 用户 id */
  user_id: string;
  /** 回复渠道 */
  channel: string;
  /** 回复文本 */
  text: string;
  /** OpenUI Lang 结构化内容（可选） */
  openui?: JsonObject;
  /** Legacy A2UI 兼容别名（旧渠道适配器仍可读取） */
  a2ui?: JsonObject;
  /** 是否成功投递 */
  delivered: boolean;
  /** 投递时间 */
  delivered_at: string;
  /** 错误信息（如果投递失败） */
  error?: string;
}

/** Channel Adapter 接口：将渠道消息归一化为 GatewayInbound */
export interface GatewayChannelAdapter {
  /** 渠道名称 */
  readonly channelName: string;
  /**
   * 归一化渠道原始 payload 为 GatewayInbound。
   * 失败时返回 null（skip 此消息）。
   */
  normalize(rawPayload: unknown): GatewayInbound | null;
  /**
   * 向渠道投递回复。
   * outbound 含 user_id / channel / text / openui。
   * 不抛错：失败返回 { ok: false, error }。
   */
  deliver(outbound: GatewayOutbound): Promise<{ ok: boolean; error?: string }>;
  /** 渠道是否当前可用（凭证是否完整） */
  isAvailable(): boolean;
}

/** 渠道身份解析结果 */
export interface ChannelIdentityResolution {
  user_id: string;
  tenant_id?: string;
  display_name?: string;
  channel_metadata?: JsonObject;
}

/** Gateway 审计事件 */
export interface GatewayAuditEvent extends JsonObject {
  at: string;
  channel: string;
  message_id: string;
  user_id: string;
  direction: "inbound" | "outbound";
  text_length: number;
  delivered: boolean;
  duration_ms?: number;
  error?: string;
}

/** 处理结果 */
export interface GatewayProcessResult {
  ok: boolean;
  message_id: string;
  user_id: string;
  channel: string;
  answer?: string;
  openui?: JsonObject;
  /** Legacy A2UI 兼容别名。 */
  a2ui?: JsonObject;
  delivered: boolean;
  duration_ms: number;
  error?: string;
}

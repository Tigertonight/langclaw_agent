import type { JsonObject } from "../types/agent-contracts.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";

/**
 * Messaging gateway 类型定义。
 *
 * 概念：
 *   - Channel：底层投递通道（console / wecom / future: 飞书/钉钉/邮件）。每条 channel 一个实现。
 *   - Gateway：网关层。注册 channels + 用户偏好 + 重试 + outbox 落盘。agent 看到的是 gateway，不是 channel。
 *   - Message：投递的内容。第一版只支持 text；后续可扩 attachments / structured cards。
 *
 * 关键决策：
 *   - to.user_id 是必填；channel 用偏好查得到不传也行。
 *   - subject 可选，用于 console 区分 + email 主题；channel 不强制使用。
 *   - send 同步等待结果；失败 Channel 抛错，Gateway 落 outbox。
 *   - dedupe_key 暂不强制；先把口子留出来，后续做去重时不用改 schema。
 */

export type MessageBodyType = "text" | "markdown";

export interface MessageBody {
  type: MessageBodyType;
  /** 主体内容。text/markdown 都用同一字段。 */
  content: string;
}

export interface MessageRecipient {
  /** 用户 ID（业务层），必填。channel 内部按需映射到 wecom_userid / email / phone。 */
  user_id: string;
}

export interface MessageRequest {
  to: MessageRecipient;
  /** 显式指定 channel；不传走偏好/默认。 */
  channel?: string;
  /** 短主题，console / email 主题用。 */
  subject?: string;
  body: MessageBody;
  /** 业务来源。审计 + 后续去重锚点。 */
  source?: string;
  /** 关联实体；常见是 cron spec_id / task id。 */
  ref?: { kind: string; id: string };
  /** 后续做去重用：相同 dedupe_key 在窗口内只发一次。第一版不消费，仅落 metadata。 */
  dedupe_key?: string;
  /** 附加元数据，channel 自由消费。 */
  metadata?: JsonObject;
}

export interface MessageDeliveryResult {
  ok: boolean;
  channel: string;
  /** channel 自定义的 message id。console 是写入序号，wecom 是 invaliduser/msgid。 */
  external_id?: string;
  /** 简短 reason；ok=true 时通常无。 */
  error?: string;
  /** detail 字段：失败时给上层调试用，channel 自由填。 */
  detail?: JsonObject;
  /** 投递耗时（含 retry）。 */
  duration_ms: number;
  attempts: number;
}

export interface ChannelSendContext {
  /** 投递目标的 workspace。审计/outbox 落盘需要。 */
  workspace: WorkspaceContext;
  /** 用户解析后的 channel-specific 地址。比如 wecom 的 wecom_userid。 */
  resolved_address?: string;
}

export interface MessageChannel {
  /** channel 名，全局唯一。例：console / wecom。 */
  readonly name: string;
  /** 是否当前可用（缺凭证就 false，不会被 gateway 选上）。 */
  isAvailable(): boolean;
  /** 投递。失败抛错，gateway 处理 retry。 */
  send(req: MessageRequest, ctx: ChannelSendContext): Promise<MessageDeliveryResult>;
}

/**
 * Recipient 偏好：user_id → 最佳 channel + 各 channel 的地址。
 * 第一版用文件 + 内存覆盖。生产可换成数据库。
 */
export interface UserChannelPrefs {
  user_id: string;
  /** 偏好顺序。第一个通的就用第一个。 */
  preferred_channels: string[];
  /** channel-specific 地址表。例：{ wecom: "ZhangSan", email: "z@x.com" }。 */
  addresses?: Record<string, string>;
}

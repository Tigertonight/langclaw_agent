import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import { UserChannelPrefsStore } from "./user-channel-prefs.js";
import type {
  MessageChannel,
  MessageRequest,
  MessageDeliveryResult,
  ChannelSendContext
} from "./types.js";

/**
 * MessageGateway —— 消息网关核心。
 *
 * 职责：
 *   1. 注册 channel；按用户偏好选 channel
 *   2. 单 channel 内的退避重试（exponential backoff，默认 3 次）
 *   3. 失败落 outbox：<workspace>/messaging/outbox.jsonl，便于离线 drain
 *   4. 审计：<workspace>/logs/messaging/sent.jsonl
 *
 * 不负责：
 *   - 去重 / 限流（P1）
 *   - 异步 worker 后台 drain outbox（P1，第一版 outbox 只是审计 + 兜底）
 *   - 卡片 / 富文本（P1）
 */

export interface SendOptions {
  workspace: WorkspaceContext;
  /** 默认 3。 */
  maxAttempts?: number;
  /** 默认 200ms 起步，每次 *2。 */
  retryBaseMs?: number;
  /** 测试注入：替代默认 setTimeout。生产不传。 */
  sleep?: (ms: number) => Promise<void>;
}

export interface GatewaySendResult {
  ok: boolean;
  /** 实际投递成功的 channel；全失败时为 null。 */
  channel: string | null;
  /** 每个 channel 的投递快照。 */
  attempts: Array<{ channel: string; ok: boolean; error?: string; duration_ms: number; tries: number }>;
  duration_ms: number;
  /** 全失败时落到 outbox 的 entry id（时间戳串）。 */
  outbox_id?: string;
}

export class MessageGateway {
  private readonly channels = new Map<string, MessageChannel>();
  private readonly prefsStore: UserChannelPrefsStore;

  constructor(opts: { prefsStore?: UserChannelPrefsStore } = {}) {
    this.prefsStore = opts.prefsStore ?? new UserChannelPrefsStore();
  }

  /** 注册一个 channel；isAvailable=false 的会被忽略，便于"没配凭证就当没注册"。 */
  register(channel: MessageChannel): boolean {
    if (!channel.isAvailable()) return false;
    this.channels.set(channel.name, channel);
    return true;
  }

  listChannels(): string[] {
    return [...this.channels.keys()];
  }

  hasChannel(name: string): boolean {
    return this.channels.has(name);
  }

  async send(req: MessageRequest, opts: SendOptions): Promise<GatewaySendResult> {
    const startedAt = Date.now();
    const maxAttempts = opts.maxAttempts ?? 3;
    const retryBaseMs = opts.retryBaseMs ?? 200;
    const sleep = opts.sleep ?? defaultSleep;

    // 1. 决定 channel 顺序：显式 > 偏好 > 默认
    const order = await this.resolveChannelOrder(req, opts.workspace);
    const attempts: GatewaySendResult["attempts"] = [];

    if (order.length === 0) {
      // 一个 channel 都没注册，直接落 outbox
      const outboxId = await this.appendOutbox(opts.workspace, req, "no_channel_registered");
      return {
        ok: false,
        channel: null,
        attempts: [],
        duration_ms: Date.now() - startedAt,
        outbox_id: outboxId
      };
    }

    // 2. 逐 channel 尝试；每 channel 内重试
    let prefs = await this.prefsStore.resolve(opts.workspace, req.to.user_id);
    for (const channelName of order) {
      const channel = this.channels.get(channelName);
      if (!channel) {
        attempts.push({ channel: channelName, ok: false, error: "channel_not_registered", duration_ms: 0, tries: 0 });
        continue;
      }
      const ctx: ChannelSendContext = {
        workspace: opts.workspace,
        resolved_address: prefs.addresses?.[channelName]
      };
      const channelStart = Date.now();
      let lastErr: unknown;
      let delivered: MessageDeliveryResult | null = null;
      let tries = 0;
      for (let i = 0; i < maxAttempts; i += 1) {
        tries += 1;
        try {
          delivered = await channel.send(req, ctx);
          if (delivered.ok) break;
          lastErr = new Error(delivered.error ?? "channel returned ok=false");
        } catch (err) {
          lastErr = err;
        }
        if (i < maxAttempts - 1) {
          await sleep(retryBaseMs * 2 ** i);
        }
      }
      const duration = Date.now() - channelStart;
      if (delivered?.ok) {
        attempts.push({ channel: channelName, ok: true, duration_ms: duration, tries });
        await this.appendAudit(opts.workspace, req, channelName, true, attempts, delivered);
        return {
          ok: true,
          channel: channelName,
          attempts,
          duration_ms: Date.now() - startedAt
        };
      }
      attempts.push({
        channel: channelName,
        ok: false,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
        duration_ms: duration,
        tries
      });
      // 失败：换下一个 channel
    }

    // 3. 全 channel 都失败 → 落 outbox + audit
    const outboxId = await this.appendOutbox(opts.workspace, req, "all_channels_failed", attempts);
    await this.appendAudit(opts.workspace, req, null, false, attempts);
    return {
      ok: false,
      channel: null,
      attempts,
      duration_ms: Date.now() - startedAt,
      outbox_id: outboxId
    };
  }

  /** 偏好优先级：req.channel > 用户偏好 > 已注册 channel 顺序。过滤掉未注册的。 */
  private async resolveChannelOrder(req: MessageRequest, workspace: WorkspaceContext): Promise<string[]> {
    const registered = new Set(this.channels.keys());
    if (req.channel) {
      return registered.has(req.channel) ? [req.channel] : [];
    }
    const prefs = await this.prefsStore.resolve(workspace, req.to.user_id);
    const preferred = prefs.preferred_channels.filter((c) => registered.has(c));
    if (preferred.length > 0) return preferred;
    // fallback：所有已注册的；console 优先
    const all = [...registered];
    return all.sort((a, b) => (a === "console" ? -1 : b === "console" ? 1 : 0));
  }

  private async appendOutbox(
    workspace: WorkspaceContext,
    req: MessageRequest,
    reason: string,
    attempts: GatewaySendResult["attempts"] = []
  ): Promise<string> {
    const dir = path.join(workspace.root, "messaging");
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    const at = new Date().toISOString();
    const id = `${at}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const line = JSON.stringify({
      id,
      at,
      reason,
      request: req,
      attempts
    });
    await appendFile(path.join(dir, "outbox.jsonl"), `${line}\n`, "utf8").catch(() => undefined);
    return id;
  }

  private async appendAudit(
    workspace: WorkspaceContext,
    req: MessageRequest,
    deliveredChannel: string | null,
    ok: boolean,
    attempts: GatewaySendResult["attempts"],
    delivery?: MessageDeliveryResult
  ): Promise<void> {
    const dir = path.join(workspace.logs_dir, "messaging");
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    const line = JSON.stringify({
      at: new Date().toISOString(),
      ok,
      delivered_channel: deliveredChannel,
      to: req.to,
      subject: req.subject ?? null,
      body_type: req.body.type,
      body_preview: req.body.content.slice(0, 200),
      source: req.source ?? null,
      ref: req.ref ?? null,
      dedupe_key: req.dedupe_key ?? null,
      attempts,
      external_id: delivery?.external_id ?? null
    });
    await appendFile(path.join(dir, "sent.jsonl"), `${line}\n`, "utf8").catch(() => undefined);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

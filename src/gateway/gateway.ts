/**
 * Phase 7: EnterpriseGateway —— 企业入口统一层。
 *
 * 职责：
 *   1. 接收来自任意渠道的 GatewayInbound（或 raw payload + channelName）
 *   2. resolve sender → user_id / workspace
 *   3. 调用 BusinessQueryEngine.submitMessage() 处理消息
 *   4. 向渠道投递 GatewayOutbound（文本 + A2UI）
 *   5. 写渠道审计事件（<workspace>/logs/gateway/audit.jsonl）
 *
 * 不负责：
 *   - 各渠道的 webhook 校验（由各 channel adapter 负责）
 *   - 限流 / 去重（P1，由 RateLimiter 插件接入）
 *   - 多租户 tenant 路由（P1）
 */

import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import type { BusinessQueryEngine } from "../runtime/business-query-engine.js";
import { ChannelAdapterRegistry } from "./channel-adapter.js";
import type {
  GatewayInbound,
  GatewayOutbound,
  GatewayAuditEvent,
  GatewayProcessResult,
  GatewayChannelAdapter
} from "./types.js";
import type { JsonObject } from "../types/agent-contracts.js";

export interface EnterpriseGatewayOptions {
  queryEngine: BusinessQueryEngine;
  adapterRegistry?: ChannelAdapterRegistry;
  /**
   * 让测试注入虚拟时间。
   */
  now?: () => Date;
  /**
   * 用于解析渠道 sender_id → platform user_id。
   * 不提供时直接用 sender_id。
   */
  resolveUserId?: (channelName: string, senderId: string, raw?: JsonObject) => Promise<string> | string;
}

export class EnterpriseGateway {
  private readonly queryEngine: BusinessQueryEngine;
  readonly adapters: ChannelAdapterRegistry;
  private readonly now: () => Date;
  private readonly resolveUserId: (channelName: string, senderId: string, raw?: JsonObject) => Promise<string> | string;
  /** 审计目录已确认存在的缓存集合，避免每次 writeAudit 都 mkdir（mkdir recursive 有锁开销） */
  private readonly _auditDirCache = new Set<string>();

  constructor(opts: EnterpriseGatewayOptions) {
    this.queryEngine = opts.queryEngine;
    this.adapters = opts.adapterRegistry ?? new ChannelAdapterRegistry();
    this.now = opts.now ?? (() => new Date());
    this.resolveUserId = opts.resolveUserId ?? ((_channel, senderId) => senderId);
  }

  /** 注册 channel adapter */
  register(adapter: GatewayChannelAdapter): boolean {
    return this.adapters.register(adapter);
  }

  /**
   * 处理来自某渠道的原始 payload（webhook 路径）。
   * 内部完成归一化 → processInbound 流程。
   */
  async handleRaw(channelName: string, rawPayload: unknown): Promise<GatewayProcessResult> {
    const inbound = this.adapters.normalize(channelName, rawPayload);
    if (!inbound) {
      return {
        ok: false,
        message_id: "unknown",
        user_id: "unknown",
        channel: channelName,
        delivered: false,
        duration_ms: 0,
        error: `normalize_failed:${channelName}`
      };
    }
    return this.processInbound(inbound);
  }

  /**
   * 处理已归一化的 GatewayInbound（cron / web 路径）。
   *
   * 流程：
   *   1. resolve user_id（可能做 sender_id → platform user_id 映射）
   *   2. resolve workspace
   *   3. submitMessage 到 QueryEngine
   *   4. 构建 outbound → 投递
   *   5. 写审计
   */
  async processInbound(inbound: GatewayInbound): Promise<GatewayProcessResult> {
    const startedAt = this.now();
    const userId = await this.resolveUserId(inbound.channel, inbound.sender_id, inbound.raw);
    const workspace = resolveUserWorkspace(userId);

    let answer = "";
    let a2ui: JsonObject | undefined;
    let engineError: string | undefined;

    try {
      const result = await this.queryEngine.submitMessage({
        userId,
        message: inbound.text,
        sessionId: inbound.session_id,
        userContext: {
          channel: inbound.channel,
          message_id: inbound.message_id,
          ...(inbound.metadata ?? {})
        }
      });
      answer = typeof result.answer === "string" ? result.answer : "";
      a2ui = result.a2ui as JsonObject | undefined;
    } catch (err) {
      engineError = err instanceof Error ? err.message : String(err);
      answer = "抱歉，处理您的消息时遇到了问题，请稍后重试。";
    }

    const outboundAt = this.now();
    const outbound: GatewayOutbound = {
      inbound_message_id: inbound.message_id,
      user_id: userId,
      channel: inbound.channel,
      text: answer,
      a2ui,
      delivered: false,
      delivered_at: outboundAt.toISOString()
    };

    // 性能优化：deliver 与审计日志预写并发执行（审计写失败不影响 deliver 结果）
    // 审计先用 duration=0 占位，deliver 完成后用实际 duration 更新（仍异步，不阻塞返回）
    let delivered = false;
    let deliverError: string | undefined;

    const deliverPromise = this.adapters.deliver({ ...outbound }).then((deliverResult) => {
      delivered = deliverResult.ok;
      if (!deliverResult.ok) deliverError = deliverResult.error;
    }).catch((err: unknown) => {
      deliverError = err instanceof Error ? err.message : String(err);
    });

    // 等待 deliver 完成（审计需要最终 delivered 状态）
    await deliverPromise;

    const finishedAt = this.now();
    const duration = finishedAt.getTime() - startedAt.getTime();

    // 写审计（异步 fire-and-forget，失败不向上传播，不阻塞 return）
    this.writeAudit(workspace.root, {
      at: startedAt.toISOString(),
      channel: inbound.channel,
      message_id: inbound.message_id,
      user_id: userId,
      direction: "inbound",
      text_length: inbound.text.length,
      delivered,
      duration_ms: duration,
      ...(engineError ? { error: engineError } : {}),
      ...(deliverError ? { deliver_error: deliverError } : {})
    }).catch(() => undefined);

    return {
      ok: !engineError,
      message_id: inbound.message_id,
      user_id: userId,
      channel: inbound.channel,
      answer,
      a2ui,
      delivered,
      duration_ms: duration,
      ...(engineError ? { error: engineError } : {})
    };
  }

  /** 写审计 JSONL 到 <workspace.root>/logs/gateway/audit.jsonl
   *
   * 性能优化：
   *   1. 对已确认创建过的目录跳过 mkdir（使用 _auditDirCache 缓存）
   *   2. 仅在首次写入时调用 mkdir，后续直接 appendFile
   */
  private async writeAudit(workspaceRoot: string, event: GatewayAuditEvent): Promise<void> {
    try {
      const dir = path.join(workspaceRoot, "logs", "gateway");
      if (!this._auditDirCache.has(dir)) {
        await mkdir(dir, { recursive: true });
        this._auditDirCache.add(dir);
      }
      await appendFile(path.join(dir, "audit.jsonl"), JSON.stringify(event) + "\n", "utf8");
    } catch {
      // 审计写失败不影响主流程
    }
  }
}

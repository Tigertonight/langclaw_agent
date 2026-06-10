/**
 * Phase 7: CronChannelAdapter —— Cron 任务渠道适配器。
 *
 * 将 cron 触发的任务结果发布到 Gateway，使 cron 子 agent 的输出
 * 能通过统一 Gateway 投递给用户（而不仅仅写入 task store）。
 *
 * 使用场景：
 *   AgentCronJobRunner 跑完后调 onAfterRun → CronChannelAdapter.deliverCronResult()
 *   → 构建 GatewayInbound（direction=outbound，text=summary）
 *   → 投递给用户
 *
 * 注意：
 *   Cron 是单向的（没有用户发消息），normalize() 用于将 cron spec 事件包装为 inbound，
 *   deliver() 通过 MessageGateway 或 WeComChannelAdapter 将摘要推给用户。
 */
import type { GatewayChannelAdapter, GatewayInbound, GatewayOutbound } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";
import type { CronHistoryEntry, UserCronSpec } from "../../cron/user-cron-store.js";

/** Cron 触发的虚拟入站事件 payload */
export interface CronTriggerPayload {
  spec: UserCronSpec;
  entry: CronHistoryEntry;
}

export class CronChannelAdapter implements GatewayChannelAdapter {
  readonly channelName = "cron";

  /**
   * deliverSink：实际把摘要推给用户的 handler（如注入 MessageGateway 或 WeComChannelAdapter）。
   * 不提供时 deliver() 只返回 ok=true（摘要已写入 task store，下次用户查看）。
   */
  private readonly deliverSink?: (outbound: GatewayOutbound) => Promise<{ ok: boolean; error?: string }>;

  constructor(opts?: {
    deliverSink?: (outbound: GatewayOutbound) => Promise<{ ok: boolean; error?: string }>;
  }) {
    this.deliverSink = opts?.deliverSink;
  }

  isAvailable(): boolean {
    // Cron 渠道始终可用
    return true;
  }

  /**
   * 将 cron 触发事件归一化为 GatewayInbound。
   * 注意：这不是真实的"用户消息"，而是系统生成的任务触发事件。
   */
  normalize(rawPayload: unknown): GatewayInbound | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;
    const p = rawPayload as CronTriggerPayload;
    if (!p.spec || !p.entry) return null;
    const userId = p.spec.user_id;
    const text = `[Cron 自动执行] ${p.spec.task.slice(0, 100)}`;
    return {
      channel: "cron",
      message_id: `cron_${p.spec.id}_${p.entry.started_at}`,
      sender_id: "cron_system",
      user_id: userId,
      text,
      received_at: p.entry.started_at,
      raw: rawPayload as JsonObject,
      metadata: {
        spec_id: p.spec.id,
        cron_expr: p.spec.cron_expr,
        entry_status: p.entry.status,
        entry_summary: p.entry.summary.slice(0, 300),
        duration_ms: p.entry.duration_ms
      }
    };
  }

  async deliver(outbound: GatewayOutbound): Promise<{ ok: boolean; error?: string }> {
    if (this.deliverSink) {
      try {
        return await this.deliverSink(outbound);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    // 没有 sink 时：摘要已在 AgentCronJobRunner 落入 task store，认为"投递成功"
    return { ok: true };
  }

  /**
   * 快捷方法：将 cron 执行结果转为 GatewayOutbound 并投递。
   * 供 AgentCronJobRunner.onAfterRun 钩子使用。
   */
  async deliverCronResult(spec: UserCronSpec, entry: CronHistoryEntry): Promise<{ ok: boolean; error?: string }> {
    const statusEmoji = entry.status === "ok" ? "✅" : "❌";
    const text = [
      `${statusEmoji} [Cron 执行完成] ${spec.task.slice(0, 80)}`,
      `状态：${entry.status} | 耗时：${entry.duration_ms}ms | 步数：${entry.iterations ?? "-"}`,
      `摘要：${entry.summary.slice(0, 500)}`
    ].join("\n");

    const outbound: GatewayOutbound = {
      inbound_message_id: `cron_${spec.id}_${entry.started_at}`,
      user_id: spec.user_id,
      channel: "cron",
      text,
      delivered: false,
      delivered_at: new Date().toISOString(),
      openui: {
        type: "cron_result",
        spec_id: spec.id,
        status: entry.status,
        summary: entry.summary.slice(0, 500),
        duration_ms: entry.duration_ms
      }
    };
    return this.deliver(outbound);
  }
}

/**
 * Phase 7: ChannelAdapterRegistry —— 渠道适配器注册表。
 *
 * 职责：
 *   - 统一管理所有 channel adapter（web/wecom/feishu/webhook/cron）
 *   - 按 channelName 查找 adapter
 *   - 归一化 raw payload → GatewayInbound
 *   - 向渠道投递 GatewayOutbound
 */
import type { GatewayChannelAdapter, GatewayInbound, GatewayOutbound } from "./types.js";

export class ChannelAdapterRegistry {
  private readonly adapters = new Map<string, GatewayChannelAdapter>();

  /** 注册 adapter（isAvailable=false 的静默跳过） */
  register(adapter: GatewayChannelAdapter): boolean {
    if (!adapter.isAvailable()) return false;
    this.adapters.set(adapter.channelName, adapter);
    return true;
  }

  /** 强制注册（忽略 isAvailable，用于测试） */
  forceRegister(adapter: GatewayChannelAdapter): void {
    this.adapters.set(adapter.channelName, adapter);
  }

  /** 按 channelName 查找 */
  get(channelName: string): GatewayChannelAdapter | null {
    return this.adapters.get(channelName) ?? null;
  }

  /** 列出所有已注册 channel 名 */
  listChannels(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** 归一化 raw payload，先找到匹配 channel 再 normalize */
  normalize(channelName: string, rawPayload: unknown): GatewayInbound | null {
    const adapter = this.adapters.get(channelName);
    if (!adapter) return null;
    return adapter.normalize(rawPayload);
  }

  /** 向指定渠道投递回复 */
  async deliver(outbound: GatewayOutbound): Promise<{ ok: boolean; error?: string }> {
    const adapter = this.adapters.get(outbound.channel);
    if (!adapter) return { ok: false, error: `adapter_not_found:${outbound.channel}` };
    try {
      return await adapter.deliver(outbound);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

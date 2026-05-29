/**
 * Attachment 内存索引：上传后的 AttachmentContext 暂存在这里，
 * 后续发送消息时按 id 拉。
 *
 * 简单的过期策略：单实例 Map + TTL（默认 30 分钟），后台定时清理。
 * 本期不持久化——附件只活在当前 session/进程内，符合 "本会话可见" 的产品约定。
 *
 * 多实例部署时这层需要换 Redis；当前是单机单进程足够。
 */
import type { AttachmentContext } from "./types.js";

const TTL_MS = 30 * 60 * 1000;

interface Entry {
  ctx: AttachmentContext;
  business_id: string;
  user_id: string;
  session_id: string;
  expires_at: number;
}

class AttachmentStore {
  private readonly entries = new Map<string, Entry>();

  put(business_id: string, user_id: string, session_id: string, ctx: AttachmentContext): void {
    this.entries.set(ctx.id, {
      ctx,
      business_id,
      user_id,
      session_id,
      expires_at: Date.now() + TTL_MS
    });
  }

  /** 拿单条；强制校验 caller business_id+user_id，防跨租户。 */
  get(business_id: string, user_id: string, id: string): AttachmentContext | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.expires_at < Date.now()) {
      this.entries.delete(id);
      return null;
    }
    if (e.business_id !== business_id || e.user_id !== user_id) {
      // 跨租户访问：当作不存在，不暴露存在性
      return null;
    }
    return e.ctx;
  }

  /** 批量拿；过滤掉 null。 */
  getMany(business_id: string, user_id: string, ids: string[]): AttachmentContext[] {
    const out: AttachmentContext[] = [];
    for (const id of ids) {
      const ctx = this.get(business_id, user_id, id);
      if (ctx) out.push(ctx);
    }
    return out;
  }

  delete(business_id: string, user_id: string, id: string): boolean {
    const ctx = this.get(business_id, user_id, id);
    if (!ctx) return false;
    return this.entries.delete(id);
  }

  /** 清理过期条目；后台定时调用。 */
  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, e] of this.entries) {
      if (e.expires_at < now) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** 仅测试用：清空所有条目。 */
  reset(): void {
    this.entries.clear();
  }
}

let singleton: AttachmentStore | null = null;
let pruneTimer: NodeJS.Timeout | null = null;

export function getAttachmentStore(): AttachmentStore {
  if (!singleton) {
    singleton = new AttachmentStore();
    if (!pruneTimer && typeof setInterval === "function") {
      pruneTimer = setInterval(() => singleton?.prune(), 5 * 60 * 1000);
      pruneTimer.unref?.();
    }
  }
  return singleton;
}

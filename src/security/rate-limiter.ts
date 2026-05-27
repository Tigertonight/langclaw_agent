export class RateLimitError extends Error {
  constructor(message: string, public readonly retryAfterMs: number) {
    super(message);
  }
}

interface SlidingWindow {
  hits: number[];
}

/**
 * 滑动窗口限流器。
 * - per-user: requestsPerMinute 控制 user 维度 QPS
 * - per-ip:   ipRequestsPerMinute 控制 IP 维度 QPS（防匿名 abuse，先级低于 per-user）
 * - 并发流：streamsPerUser 限制同一 user 同时打开的 SSE 连接数
 */
export class RateLimiter {
  private readonly userWindows = new Map<string, SlidingWindow>();
  private readonly ipWindows = new Map<string, SlidingWindow>();
  private readonly activeStreams = new Map<string, number>();

  constructor(
    private readonly windowMs = 60_000,
    private readonly requestsPerMinute = 30,
    private readonly ipRequestsPerMinute = 60,
    private readonly streamsPerUser = 3
  ) {}

  acquireUser(userId: string): void {
    if (!userId) return;
    const now = Date.now();
    const window = this.userWindows.get(userId) ?? { hits: [] };
    window.hits = window.hits.filter((ts) => now - ts < this.windowMs);
    if (window.hits.length >= this.requestsPerMinute) {
      const oldest = window.hits[0];
      throw new RateLimitError("user rate limit exceeded", this.windowMs - (now - oldest));
    }
    window.hits.push(now);
    this.userWindows.set(userId, window);
  }

  acquireIp(ip: string): void {
    if (!ip) return;
    const now = Date.now();
    const window = this.ipWindows.get(ip) ?? { hits: [] };
    window.hits = window.hits.filter((ts) => now - ts < this.windowMs);
    if (window.hits.length >= this.ipRequestsPerMinute) {
      const oldest = window.hits[0];
      throw new RateLimitError("ip rate limit exceeded", this.windowMs - (now - oldest));
    }
    window.hits.push(now);
    this.ipWindows.set(ip, window);
  }

  acquireStream(userId: string): () => void {
    if (!userId) return () => {};
    const current = this.activeStreams.get(userId) ?? 0;
    if (current >= this.streamsPerUser) {
      throw new RateLimitError(`max ${this.streamsPerUser} concurrent streams per user`, 1000);
    }
    this.activeStreams.set(userId, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.activeStreams.get(userId) ?? 1) - 1;
      if (next <= 0) this.activeStreams.delete(userId);
      else this.activeStreams.set(userId, next);
    };
  }

  snapshot(): { userWindowCount: number; ipWindowCount: number; activeStreams: number } {
    let activeStreams = 0;
    for (const v of this.activeStreams.values()) activeStreams += v;
    return {
      userWindowCount: this.userWindows.size,
      ipWindowCount: this.ipWindows.size,
      activeStreams
    };
  }
}

export function readClientIp(req: { socket?: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded) && forwarded.length) return forwarded[0];
  return req.socket?.remoteAddress ?? "";
}

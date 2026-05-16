interface TokenCacheItem<T> {
  value: T;
  expiresAt: number;
}

export class TokenCache<T = string> {
  private readonly items = new Map<string, TokenCacheItem<T>>();

  get(key: string): T | null {
    const item = this.items.get(key);
    if (!item) return null;
    if (Date.now() >= item.expiresAt - 60_000) {
      this.items.delete(key);
      return null;
    }
    return item.value;
  }

  set(key: string, value: T, expiresInSeconds = 7200): void {
    this.items.set(key, {
      value,
      expiresAt: Date.now() + expiresInSeconds * 1000
    });
  }
}

export class TokenCache {
  constructor() {
    this.items = new Map();
  }

  get(key) {
    const item = this.items.get(key);
    if (!item) return null;
    if (Date.now() >= item.expiresAt - 60_000) {
      this.items.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, expiresInSeconds = 7200) {
    this.items.set(key, {
      value,
      expiresAt: Date.now() + expiresInSeconds * 1000
    });
  }
}

export interface Clock {
  now(): number;
}

export class TtlMemo<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: Clock = { now: () => Date.now() },
  ) {
    if (ttlMs < 0) throw new RangeError("ttlMs must be non-negative");
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.set(key, { value, expiresAt: this.clock.now() + this.ttlMs });
  }

  getOrSet(key: K, factory: () => V): V {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = factory();
    this.set(key, value);
    return value;
  }

  prune(): number {
    const now = this.clock.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }
}

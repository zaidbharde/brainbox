export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now = Date.now(),
  ) {
    if (capacity <= 0 || refillPerSecond <= 0) throw new RangeError('bucket settings must be positive');
    this.tokens = capacity;
    this.updatedAt = now;
  }

  tryConsume(count = 1, now = Date.now()): boolean {
    if (count < 0 || count > this.capacity) return false;
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.updatedAt = now;
    if (this.tokens < count) return false;
    this.tokens -= count;
    return true;
  }

  available(now = Date.now()): number {
    this.tryConsume(0, now);
    return Math.floor(this.tokens);
  }
}

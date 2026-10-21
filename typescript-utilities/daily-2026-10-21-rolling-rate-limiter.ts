export class RollingRateLimiter {
  private readonly timestamps: number[] = [];

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || windowMs <= 0)
      throw new Error('invalid limiter configuration');
  }

  public tryAcquire(nowMs = Date.now()): boolean {
    this.evict(nowMs);
    if (this.timestamps.length >= this.limit) return false;
    this.timestamps.push(nowMs);
    return true;
  }

  public remaining(nowMs = Date.now()): number {
    this.evict(nowMs);
    return this.limit - this.timestamps.length;
  }

  public retryAfterMs(nowMs = Date.now()): number {
    this.evict(nowMs);
    return this.timestamps.length === 0
      ? 0
      : Math.max(0, this.timestamps[0] + this.windowMs - nowMs);
  }

  private evict(nowMs: number): void {
    let remove = 0;
    while (remove < this.timestamps.length && nowMs - this.timestamps[remove] >= this.windowMs)
      remove += 1;
    if (remove > 0) this.timestamps.splice(0, remove);
  }
}

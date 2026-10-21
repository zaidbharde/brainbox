export class BoundedEventBuffer<T> {
  private readonly events: T[] = [];
  private dropped = 0;

  public constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be positive');
  }

  public add(event: T): void {
    if (this.events.length === this.capacity) {
      this.events.shift();
      this.dropped += 1;
    }
    this.events.push(event);
  }

  public poll(): T | undefined { return this.events.shift(); }
  public snapshot(): readonly T[] { return this.events.slice(); }
  public size(): number { return this.events.length; }
  public droppedCount(): number { return this.dropped; }

  public clear(): void {
    this.events.length = 0;
    this.dropped = 0;
  }
}

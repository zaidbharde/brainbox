export class CircularBuffer<T> {
  private readonly values: Array<T | undefined>;
  private start = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('capacity must be a positive integer');
    }
    this.values = new Array<T | undefined>(capacity);
  }

  push(value: T): T | undefined {
    const index = (this.start + this.count) % this.capacity;
    const removed = this.count === this.capacity ? this.values[index] : undefined;
    this.values[index] = value;
    if (this.count < this.capacity) this.count += 1;
    else this.start = (this.start + 1) % this.capacity;
    return removed;
  }

  toArray(): T[] {
    return Array.from({ length: this.count }, (_, i) =>
      this.values[(this.start + i) % this.capacity] as T,
    );
  }
}

export class WeightedSampler<T> {
  private readonly values: T[];
  private readonly cumulative: number[];
  private readonly total: number;

  public constructor(weights: ReadonlyMap<T, number>) {
    if (weights.size === 0) throw new Error('weights cannot be empty');
    this.values = [...weights.keys()];
    this.cumulative = [];
    let running = 0;
    for (const value of this.values) {
      const weight = weights.get(value)!;
      if (!Number.isFinite(weight) || weight < 0) throw new Error('invalid weight');
      running += weight;
      this.cumulative.push(running);
    }
    if (running <= 0) throw new Error('all weights are zero');
    this.total = running;
  }

  public sample(random: () => number = Math.random): T {
    const ticket = random() * this.total;
    let low = 0;
    let high = this.cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (ticket < this.cumulative[middle]) high = middle;
      else low = middle + 1;
    }
    return this.values[low];
  }

  public totalWeight(): number { return this.total; }
  public options(): readonly T[] { return this.values.slice(); }
}

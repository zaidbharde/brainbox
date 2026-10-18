export interface PoolOptions {
  concurrency: number;
}

export async function mapConcurrent<T, R>(
  values: readonly T[],
  worker: (value: T, index: number) => Promise<R>,
  options: PoolOptions,
): Promise<R[]> {
  if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
    throw new RangeError("concurrency must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function consume(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(options.concurrency, values.length) },
    () => consume(),
  );
  await Promise.all(workers);
  return results;
}

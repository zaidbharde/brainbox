export type Interval = readonly [start: number, end: number];

export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .map(([start, end]) => {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        throw new RangeError('intervals must contain finite start/end pairs');
      }
      return [start, end] as [number, number];
    })
    .sort(([left], [right]) => left - right);
  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval[0] > previous[1]) merged.push(interval);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

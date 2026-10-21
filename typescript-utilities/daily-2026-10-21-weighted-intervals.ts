export type WeightedInterval = {
  start: number;
  end: number;
  value: number;
};

/** Returns a maximum-value compatible subset in stable end-time order. */
export function selectWeightedIntervals(input: readonly WeightedInterval[]): WeightedInterval[] {
  const items = [...input].sort((a, b) => a.end - b.end || a.start - b.start);
  const best = new Array<number>(items.length + 1).fill(0);
  const previous = items.map((item, index) => {
    let low = 0;
    let high = index - 1;
    let answer = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (items[middle].end <= item.start) {
        answer = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return answer;
  });
  for (let index = 0; index < items.length; index += 1)
    best[index + 1] = Math.max(best[index], best[previous[index] + 1] + items[index].value);
  const result: WeightedInterval[] = [];
  for (let index = items.length; index > 0;) {
    if (best[index] === best[index - 1]) index -= 1;
    else { result.push(items[index - 1]); index = previous[index - 1] + 1; }
  }
  return result.reverse();
}

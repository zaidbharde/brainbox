export type KeySelector<T, K> = (value: T, index: number) => K;

export function groupByKey<T, K>(
  values: readonly T[],
  selectKey: KeySelector<T, K>,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  values.forEach((value, index) => {
    const key = selectKey(value, index);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(value);
    } else {
      groups.set(key, [value]);
    }
  });
  return groups;
}

export function countByKey<T, K>(
  values: readonly T[],
  selectKey: KeySelector<T, K>,
): Map<K, number> {
  const counts = new Map<K, number>();
  values.forEach((value, index) => {
    const key = selectKey(value, index);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}

export function mapGroups<T, K, R>(
  values: readonly T[],
  selectKey: KeySelector<T, K>,
  transform: (group: readonly T[], key: K) => R,
): Map<K, R> {
  const result = new Map<K, R>();
  for (const [key, group] of groupByKey(values, selectKey)) {
    result.set(key, transform(group, key));
  }
  return result;
}

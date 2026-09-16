export function stableHash(value: unknown): string {
  const encoded = JSON.stringify(value, (_, current) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    return Object.keys(current).sort().reduce<Record<string, unknown>>((out, key) => {
      out[key] = current[key];
      return out;
    }, {});
  });
  let hash = 2166136261;
  for (const character of encoded ?? '') {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

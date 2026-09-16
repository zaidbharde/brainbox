export function topologicalOrder<T>(nodes: readonly T[], edges: readonly (readonly [T, T])[]): T[] {
  const indegree = new Map<T, number>(nodes.map(node => [node, 0]));
  const outgoing = new Map<T, T[]>(nodes.map(node => [node, []]));
  for (const [from, to] of edges) {
    if (!indegree.has(from) || !indegree.has(to)) throw new Error('edge references unknown node');
    outgoing.get(from)!.push(to);
    indegree.set(to, indegree.get(to)! + 1);
  }
  const ready = nodes.filter(node => indegree.get(node) === 0);
  const result: T[] = [];
  while (ready.length) {
    const current = ready.shift()!;
    result.push(current);
    for (const next of outgoing.get(current)!) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (result.length !== nodes.length) throw new Error('graph contains a cycle');
  return result;
}

export function dependencyLayers<T>(graph: ReadonlyMap<T, readonly T[]>): T[][] {
  const remaining = new Map<T, Set<T>>();
  for (const [node, dependencies] of graph) remaining.set(node, new Set(dependencies));
  for (const dependencies of graph.values())
    for (const dependency of dependencies)
      if (!remaining.has(dependency)) remaining.set(dependency, new Set());

  const layers: T[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([node]) => node)
      .sort((a, b) => String(a).localeCompare(String(b)));
    if (ready.length === 0) throw new Error('dependency cycle detected');
    layers.push(ready);
    for (const node of ready) remaining.delete(node);
    for (const dependencies of remaining.values())
      for (const node of ready) dependencies.delete(node);
  }
  return layers;
}

export function flattenDependencyLayers<T>(graph: ReadonlyMap<T, readonly T[]>): T[] {
  return dependencyLayers(graph).flat();
}

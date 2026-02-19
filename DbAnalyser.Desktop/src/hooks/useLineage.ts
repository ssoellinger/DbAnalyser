import type { TableDependency, ObjectDependency } from '../api/types';

export interface LineageResult {
  upstream: Map<number, string[]>;   // layer -> node names
  downstream: Map<number, string[]>;
  selected: string;
}

export function computeLineage(
  selected: string,
  dependencies: TableDependency[],
  objectDependencies: ObjectDependency[]
): LineageResult {
  const depMap = new Map<string, TableDependency>();
  dependencies.forEach((d) => depMap.set(d.fullName, d));

  // Build adjacency for reverse lookup too
  const forwardAdj = new Map<string, Set<string>>(); // node -> depends on
  const reverseAdj = new Map<string, Set<string>>(); // node -> referenced by

  dependencies.forEach((d) => {
    forwardAdj.set(d.fullName, new Set(d.dependsOn));
    if (!reverseAdj.has(d.fullName)) reverseAdj.set(d.fullName, new Set());
    d.dependsOn.forEach((dep) => {
      if (!reverseAdj.has(dep)) reverseAdj.set(dep, new Set());
      reverseAdj.get(dep)!.add(d.fullName);
    });
  });

  // Also include object dependencies
  objectDependencies.forEach((od) => {
    const from = `${od.fromSchema}.${od.fromName}`;
    const to = od.toFullName;
    if (!forwardAdj.has(from)) forwardAdj.set(from, new Set());
    forwardAdj.get(from)!.add(to);
    if (!reverseAdj.has(to)) reverseAdj.set(to, new Set());
    reverseAdj.get(to)!.add(from);
  });

  // BFS upstream (things selected depends on)
  const upstream = bfs(selected, forwardAdj);

  // BFS downstream (things that depend on selected)
  const downstream = bfs(selected, reverseAdj);

  return { upstream, downstream, selected };
}

function bfs(start: string, adj: Map<string, Set<string>>): Map<number, string[]> {
  const layers = new Map<number, string[]>();
  const visited = new Set<string>();
  visited.add(start);

  let currentLayer = [start];
  let depth = 0;

  while (currentLayer.length > 0) {
    const nextLayer: string[] = [];
    for (const node of currentLayer) {
      const neighbors = adj.get(node);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextLayer.push(neighbor);
        }
      }
    }
    if (nextLayer.length > 0) {
      depth++;
      layers.set(depth, nextLayer);
    }
    currentLayer = nextLayer;
  }

  return layers;
}

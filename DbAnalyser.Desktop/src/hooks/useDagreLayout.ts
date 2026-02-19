import dagre from '@dagrejs/dagre';
import { type Node, type Edge } from '@xyflow/react';

interface LayoutOptions {
  direction?: 'TB' | 'LR' | 'RL' | 'BT';
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
  ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
}

function findConnectedComponents(nodes: Node[], edges: Edge[]): Node[][] {
  const parent = new Map<string, string>();
  nodes.forEach((n) => parent.set(n.id, n.id));

  function find(id: string): string {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)!)!);
      id = parent.get(id)!;
    }
    return id;
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  edges.forEach((e) => {
    if (parent.has(e.source) && parent.has(e.target)) {
      union(e.source, e.target);
    }
  });

  const groups = new Map<string, Node[]>();
  nodes.forEach((n) => {
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(n);
  });

  // Sort: largest component first
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

function layoutComponent(
  nodes: Node[],
  edges: Edge[],
  options: Required<Omit<LayoutOptions, 'ranker'>> & { ranker: string },
): { nodes: Node[]; edges: Edge[]; width: number; height: number } {
  const { direction, nodeWidth, nodeHeight, rankSep, nodeSep, ranker } = options;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep, ranker });

  const nodeIds = new Set(nodes.map((n) => n.id));

  nodes.forEach((node) => {
    const w = (node.measured?.width ?? node.width ?? nodeWidth) as number;
    const h = (node.measured?.height ?? node.height ?? nodeHeight) as number;
    g.setNode(node.id, { width: w, height: h });
  });

  const componentEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  componentEdges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const w = (node.measured?.width ?? node.width ?? nodeWidth) as number;
    const h = (node.measured?.height ?? node.height ?? nodeHeight) as number;
    const x = pos.x - w / 2;
    const y = pos.y - h / 2;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
    return { ...node, position: { x, y } };
  });

  // Normalize to (0, 0)
  const normalized = layoutedNodes.map((n) => ({
    ...n,
    position: { x: n.position.x - minX, y: n.position.y - minY },
  }));

  return {
    nodes: normalized,
    edges: componentEdges,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  const {
    direction = 'TB',
    nodeWidth = 180,
    nodeHeight = 50,
    rankSep = 80,
    nodeSep = 40,
    ranker = 'network-simplex',
  } = options;

  if (nodes.length === 0) return { nodes, edges };

  const opts = { direction, nodeWidth, nodeHeight, rankSep, nodeSep, ranker } as const;
  const components = findConnectedComponents(nodes, edges);

  if (components.length === 1) {
    const result = layoutComponent(nodes, edges, opts);
    // Center around (0, 0)
    const cx = result.width / 2;
    const cy = result.height / 2;
    return {
      nodes: result.nodes.map((n) => ({
        ...n,
        position: { x: n.position.x - cx, y: n.position.y - cy },
      })),
      edges,
    };
  }

  // Layout each component, then arrange them in a centered grid
  const laid = components.map((comp) => layoutComponent(comp, edges, opts));
  const gap = Math.max(15, rankSep / 2);

  // Place components in rows, centered horizontally
  const allNodes: Node[] = [];
  let cursorY = 0;
  let rowComponents: typeof laid = [];
  let rowWidth = 0;
  const maxRowWidth = laid[0].width * 2.5; // row width based on largest component

  const rows: { components: typeof laid; width: number; height: number }[] = [];

  for (const comp of laid) {
    if (rowWidth > 0 && rowWidth + comp.width + gap > maxRowWidth) {
      const rowHeight = Math.max(...rowComponents.map((c) => c.height));
      rows.push({ components: rowComponents, width: rowWidth, height: rowHeight });
      rowComponents = [];
      rowWidth = 0;
    }
    rowComponents.push(comp);
    rowWidth += (rowWidth > 0 ? gap : 0) + comp.width;
  }
  if (rowComponents.length > 0) {
    const rowHeight = Math.max(...rowComponents.map((c) => c.height));
    rows.push({ components: rowComponents, width: rowWidth, height: rowHeight });
  }

  // Calculate total height to center vertically
  const totalHeight = rows.reduce((sum, r) => sum + r.height, 0) + (rows.length - 1) * gap;
  const totalWidth = Math.max(...rows.map((r) => r.width));

  cursorY = -totalHeight / 2;
  for (const row of rows) {
    let cursorX = -row.width / 2;
    for (const comp of row.components) {
      const yOffset = cursorY + (row.height - comp.height) / 2;
      for (const node of comp.nodes) {
        allNodes.push({
          ...node,
          position: {
            x: node.position.x + cursorX,
            y: node.position.y + yOffset,
          },
        });
      }
      cursorX += comp.width + gap;
    }
    cursorY += row.height + gap;
  }

  return { nodes: allNodes, edges };
}

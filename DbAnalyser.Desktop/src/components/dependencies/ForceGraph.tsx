import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { OBJECT_TYPE_COLORS } from '../../api/types';

export interface GraphNode {
  id: string;
  label: string;
  type: string;       // "table", "view", "procedure", "function", "trigger", "synonym", etc.
  refBy: number;
  depOn: number;
  impact: number;
  score: number;
}

export interface GraphEdge {
  source: number;
  target: number;
  type: string;       // "fk" | "view" | "implicit"
}

interface ForceGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  fx?: number;
  fy?: number;
}

type NodeShape = 'circle' | 'diamond' | 'rect';

function getNodeShape(type: string): NodeShape {
  switch (type) {
    case 'table': return 'circle';
    case 'view': return 'diamond';
    default: return 'rect';  // procedure, function, trigger, synonym, job, external
  }
}

function getNodeFill(n: { type: string; refBy: number; score: number }, maxScore: number): string {
  if (n.type === 'table') {
    const hue = n.refBy > 0 ? (n.refBy > 5 ? 0 : 30) : 200;
    const lightness = 50 + (n.score / maxScore) * 20;
    return `hsl(${hue}, 70%, ${lightness}%)`;
  }
  // Use the canonical color for this object type
  const key = n.type.charAt(0).toUpperCase() + n.type.slice(1);
  return OBJECT_TYPE_COLORS[key] ?? '#666';
}

function getEdgeStroke(type: string): string {
  if (type === 'view') return '#4ecca3';
  if (type === 'implicit') return '#78909c';
  return '#4fc3f7';
}

function getEdgeDash(type: string): string | undefined {
  if (type === 'view') return '6,3';
  if (type === 'implicit') return '2,4';
  return undefined;
}

export function ForceGraph({ nodes, edges }: ForceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{ nodeIndex: number | null; offset: { x: number; y: number } }>({
    nodeIndex: null,
    offset: { x: 0, y: 0 },
  });

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    node: GraphNode | null;
  }>({ visible: false, x: 0, y: 0, node: null });

  const [hoveredNode, setHoveredNode] = useState<number | null>(null);

  // Compute which distinct types are present for the legend
  const presentTypes = useMemo(() => {
    const types = new Set(nodes.map((n) => n.type));
    return types;
  }, [nodes]);

  // Initialize simulation nodes whenever input changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const maxScore = Math.max(...nodes.map((n) => n.score), 1);

    const simNodes: SimNode[] = nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const r = Math.min(width, height) * 0.35;
      return {
        ...n,
        x: width / 2 + r * Math.cos(angle),
        y: height / 2 + r * Math.sin(angle),
        vx: 0,
        vy: 0,
        radius: 6 + (n.score / maxScore) * 20,
      };
    });
    simNodesRef.current = simNodes;

    // Force simulation tick
    const tick = () => {
      const N = simNodes.length;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const dragNodeIdx = dragRef.current.nodeIndex;

      // Repulsion (all pairs)
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = simNodes[i].x - simNodes[j].x;
          const dy = simNodes[i].y - simNodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 800 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          simNodes[i].vx += fx;
          simNodes[i].vy += fy;
          simNodes[j].vx -= fx;
          simNodes[j].vy -= fy;
        }
      }

      // Attraction (edges)
      edges.forEach((e) => {
        if (e.source >= N || e.target >= N) return;
        const s = simNodes[e.source];
        const t = simNodes[e.target];
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.005;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      });

      // Center gravity
      simNodes.forEach((n) => {
        n.vx += (w / 2 - n.x) * 0.001;
        n.vy += (h / 2 - n.y) * 0.001;
      });

      // Apply velocity
      simNodes.forEach((n, i) => {
        if (i === dragNodeIdx) {
          n.x = n.fx!;
          n.y = n.fy!;
          n.vx = 0;
          n.vy = 0;
          return;
        }
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(n.radius, Math.min(w - n.radius, n.x));
        n.y = Math.max(n.radius, Math.min(h - n.radius, n.y));
      });

      // Update SVG elements directly for performance
      const svg = svgRef.current;
      if (!svg) return;

      // Update edges
      const edgeLines = svg.querySelectorAll<SVGLineElement>('.fg-edge');
      edgeLines.forEach((line, idx) => {
        const e = edges[idx];
        if (!e || e.source >= N || e.target >= N) return;
        const s = simNodes[e.source];
        const t = simNodes[e.target];
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offsetS = s.radius / dist;
        const offsetT = t.radius / dist;
        line.setAttribute('x1', String(s.x + dx * offsetS));
        line.setAttribute('y1', String(s.y + dy * offsetS));
        line.setAttribute('x2', String(t.x - dx * offsetT));
        line.setAttribute('y2', String(t.y - dy * offsetT));
      });

      // Update nodes
      const nodeEls = svg.querySelectorAll<SVGElement>('.fg-node');
      nodeEls.forEach((el, idx) => {
        const n = simNodes[idx];
        if (!n) return;
        const shape = getNodeShape(n.type);
        if (shape === 'diamond') {
          const r = n.radius;
          (el as SVGPolygonElement).setAttribute(
            'points',
            `${n.x},${n.y - r} ${n.x + r},${n.y} ${n.x},${n.y + r} ${n.x - r},${n.y}`,
          );
        } else if (shape === 'rect') {
          const r = n.radius;
          el.setAttribute('x', String(n.x - r));
          el.setAttribute('y', String(n.y - r));
          el.setAttribute('width', String(r * 2));
          el.setAttribute('height', String(r * 2));
        } else {
          el.setAttribute('cx', String(n.x));
          el.setAttribute('cy', String(n.y));
        }
      });

      // Update labels
      const labelEls = svg.querySelectorAll<SVGTextElement>('.fg-label');
      labelEls.forEach((el, idx) => {
        const n = simNodes[idx];
        if (!n) return;
        el.setAttribute('x', String(n.x));
        el.setAttribute('y', String(n.y + n.radius + 14));
      });

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [nodes, edges]);

  // Mouse handlers for drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const simNodes = simNodesRef.current;
      for (let i = 0; i < simNodes.length; i++) {
        const n = simNodes[i];
        if (Math.hypot(mx - n.x, my - n.y) < n.radius + 5) {
          dragRef.current = { nodeIndex: i, offset: { x: mx - n.x, y: my - n.y } };
          simNodes[i].fx = n.x;
          simNodes[i].fy = n.y;
          svg.style.cursor = 'grabbing';
          break;
        }
      }
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const simNodes = simNodesRef.current;

      if (dragRef.current.nodeIndex !== null) {
        const idx = dragRef.current.nodeIndex;
        simNodes[idx].fx = mx - dragRef.current.offset.x;
        simNodes[idx].fy = my - dragRef.current.offset.y;
        return;
      }

      // Hover detection
      let found = false;
      for (let i = 0; i < simNodes.length; i++) {
        const n = simNodes[i];
        if (Math.hypot(mx - n.x, my - n.y) < n.radius + 5) {
          setTooltip({ visible: true, x: e.clientX, y: e.clientY, node: n });
          setHoveredNode(i);
          svg.style.cursor = 'grab';
          found = true;
          break;
        }
      }
      if (!found) {
        if (tooltip.visible) {
          setTooltip((t) => (t.visible ? { ...t, visible: false, node: null } : t));
          setHoveredNode(null);
        }
        svg.style.cursor = 'default';
      }
    },
    [tooltip.visible],
  );

  const handleMouseUp = useCallback(() => {
    const simNodes = simNodesRef.current;
    const idx = dragRef.current.nodeIndex;
    if (idx !== null) {
      simNodes[idx].x = simNodes[idx].fx!;
      simNodes[idx].y = simNodes[idx].fy!;
      delete simNodes[idx].fx;
      delete simNodes[idx].fy;
    }
    dragRef.current = { nodeIndex: null, offset: { x: 0, y: 0 } };
    if (svgRef.current) svgRef.current.style.cursor = 'default';
  }, []);

  const handleMouseLeave = useCallback(() => {
    handleMouseUp();
    setTooltip((t) => (t.visible ? { ...t, visible: false, node: null } : t));
    setHoveredNode(null);
  }, [handleMouseUp]);

  const maxScore = Math.max(...nodes.map((n) => n.score), 1);

  // Build the legend dynamically from types present in the data
  const legendItems = useMemo(() => {
    const items: { symbol: string; color: string; label: string }[] = [];
    // Tables always get heat-map treatment — show core + normal
    if (presentTypes.has('table')) {
      items.push({ symbol: '\u25CF', color: '#e94560', label: 'Core table' });
      items.push({ symbol: '\u25CF', color: '#4fc3f7', label: 'Table' });
    }
    if (presentTypes.has('view')) {
      items.push({ symbol: '\u25C6', color: '#4ecca3', label: 'View' });
    }
    // Other programmable object types — use rounded-square symbol
    const otherTypes = ['procedure', 'function', 'trigger', 'synonym', 'job', 'external'];
    for (const t of otherTypes) {
      if (presentTypes.has(t)) {
        const key = t.charAt(0).toUpperCase() + t.slice(1);
        items.push({ symbol: '\u25A0', color: OBJECT_TYPE_COLORS[key] ?? '#666', label: key });
      }
    }
    return items;
  }, [presentTypes]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <svg
        ref={svgRef}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <marker
            id="fg-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4fc3f7" />
          </marker>
        </defs>

        {/* Edges */}
        <g>
          {edges.map((e, i) => {
            const isHovered =
              hoveredNode !== null && (e.source === hoveredNode || e.target === hoveredNode);
            return (
              <line
                key={i}
                className="fg-edge"
                stroke={getEdgeStroke(e.type)}
                strokeOpacity={isHovered ? 1 : 0.4}
                strokeWidth={isHovered ? 2.5 : 1.5}
                strokeDasharray={getEdgeDash(e.type)}
                markerEnd="url(#fg-arrow)"
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {nodes.map((n, i) => {
            const isHovered = hoveredNode === i;
            const radius = 6 + (n.score / maxScore) * 20;
            const fill = getNodeFill(n, maxScore);
            const shape = getNodeShape(n.type);

            if (shape === 'diamond') {
              return (
                <polygon
                  key={n.id}
                  className="fg-node"
                  fill={fill}
                  stroke="#e0e0e0"
                  strokeWidth={isHovered ? 3 : 1}
                  points="0,0 0,0 0,0 0,0"
                />
              );
            }
            if (shape === 'rect') {
              return (
                <rect
                  key={n.id}
                  className="fg-node"
                  rx={4}
                  ry={4}
                  fill={fill}
                  stroke="#e0e0e0"
                  strokeWidth={isHovered ? 3 : 1}
                  width={radius * 2}
                  height={radius * 2}
                />
              );
            }
            return (
              <circle
                key={n.id}
                className="fg-node"
                r={radius}
                fill={fill}
                stroke="#e0e0e0"
                strokeWidth={isHovered ? 3 : 1}
              />
            );
          })}
        </g>

        {/* Labels */}
        <g>
          {nodes.map((n) => {
            const radius = 6 + (n.score / maxScore) * 20;
            const fontSize = Math.max(9, Math.min(13, 8 + radius / 4));
            return (
              <text
                key={n.id}
                className="fg-label"
                fontSize={fontSize}
                fill="#e0e0e0"
                textAnchor="middle"
                pointerEvents="none"
              >
                {n.label}
              </text>
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip.visible && tooltip.node && (
        <div
          className="fixed z-50 pointer-events-none rounded-md border px-3 py-2 text-sm"
          style={{
            left: tooltip.x + 15,
            top: tooltip.y - 10,
            background: '#16213e',
            borderColor: '#0f3460',
            color: '#e0e0e0',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          <strong>{tooltip.node.id}</strong>
          <br />
          Type: {tooltip.node.type}
          <br />
          Referenced by: {tooltip.node.refBy}
          <br />
          Depends on: {tooltip.node.depOn}
          <br />
          Impact: {tooltip.node.impact}
          <br />
          Score: {tooltip.node.score}
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex items-center gap-4 text-xs text-text-muted bg-bg-primary/80 rounded px-3 py-1.5 border border-border">
        <span>Drag nodes to rearrange. Hover for details. Node size = importance.</span>
        {legendItems.map((item) => (
          <span key={item.label} className="flex items-center gap-1">
            <span style={{ color: item.color }}>{item.symbol}</span> {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

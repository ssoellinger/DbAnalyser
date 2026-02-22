import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { getDatabaseColor } from '../dashboard/DashboardPage';

export interface GraphNode {
  id: string;
  label: string;
  type: string;       // "table", "view", "procedure", "function", "trigger", "synonym", etc.
  refBy: number;
  depOn: number;
  impact: number;
  score: number;
  database?: string;
}

export interface GraphEdge {
  source: number;
  target: number;
  type: string;       // "fk" | "view" | "implicit"
  crossDatabase?: boolean;
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

function getEdgeStroke(type: string, crossDatabase?: boolean): string {
  if (crossDatabase) return '#ff6b6b';
  if (type === 'view') return '#4ecca3';
  if (type === 'implicit') return '#78909c';
  return '#4fc3f7';
}

function getEdgeDash(type: string, crossDatabase?: boolean): string | undefined {
  if (crossDatabase) return '8,4';
  if (type === 'view') return '6,3';
  if (type === 'implicit') return '2,4';
  return undefined;
}

function getEdgeWidth(type: string, crossDatabase?: boolean, isHovered?: boolean): number {
  if (isHovered) return crossDatabase ? 3.5 : 2.5;
  return crossDatabase ? 3 : 1.5;
}

// Graham scan convex hull
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: { x: number; y: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Pad hull outward from centroid
function padHull(hull: { x: number; y: number }[], cx: number, cy: number, padding: number): { x: number; y: number }[] {
  return hull.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: p.x + (dx / dist) * padding, y: p.y + (dy / dist) * padding };
  });
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.2;

// Module-level cache for settled node positions so revisiting the page is instant
interface CachedLayout {
  positions: Map<string, { x: number; y: number }>;
  view: { scale: number; panX: number; panY: number };
}
let layoutCache: CachedLayout | null = null;
let layoutCacheKey = '';

export function ForceGraph({ nodes, edges }: ForceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{
    nodeIndex: number | null;
    offset: { x: number; y: number };
    isPan: boolean;
    panStart: { x: number; y: number };
  }>({
    nodeIndex: null,
    offset: { x: 0, y: 0 },
    isPan: false,
    panStart: { x: 0, y: 0 },
  });
  const viewRef = useRef({ scale: 1, panX: 0, panY: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  // Determine if multi-database mode is active
  const databases = useMemo(() => {
    const dbs = new Set(nodes.map((n) => n.database).filter(Boolean) as string[]);
    return dbs.size > 1 ? [...dbs] : [];
  }, [nodes]);
  const hasDatabases = databases.length > 0;
  const hasCrossDbEdges = useMemo(() => edges.some((e) => e.crossDatabase), [edges]);

  // Convert screen-relative coords to world coords (accounting for zoom/pan)
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const v = viewRef.current;
    return { x: (sx - v.panX) / v.scale, y: (sy - v.panY) / v.scale };
  }, []);

  // Apply the current viewport transform to the SVG <g> wrapper
  const applyViewTransform = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const vp = svg.querySelector<SVGGElement>('.fg-viewport');
    if (!vp) return;
    const v = viewRef.current;
    vp.setAttribute('transform', `translate(${v.panX},${v.panY}) scale(${v.scale})`);
  }, []);

  // Fit all nodes into view
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    const simNodes = simNodesRef.current;
    if (!container || simNodes.length === 0) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    simNodes.forEach((n) => {
      minX = Math.min(minX, n.x - n.radius);
      minY = Math.min(minY, n.y - n.radius);
      maxX = Math.max(maxX, n.x + n.radius);
      maxY = Math.max(maxY, n.y + n.radius);
    });
    const padding = 60;
    const bw = maxX - minX + padding * 2;
    const bh = maxY - minY + padding * 2;
    const scale = Math.max(0.3, Math.min(w / bw, h / bh, 2));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    viewRef.current = {
      scale,
      panX: w / 2 - cx * scale,
      panY: h / 2 - cy * scale,
    };
    applyViewTransform();
  }, [applyViewTransform]);

  // Initialize simulation nodes whenever input changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const maxScore = Math.max(...nodes.map((n) => n.score), 1);

    // Scale simulation space with node count so larger datasets spread out
    const N = nodes.length;
    const scaleFactor = Math.max(1, Math.sqrt(N / 30));
    const repulsion = 800 * scaleFactor;
    const edgeRestLength = 120 * scaleFactor;

    // Check if we have cached positions for this exact node set
    const cacheKey = nodes.map((n) => n.id).sort().join('|');
    const hasCache = layoutCache !== null && layoutCacheKey === cacheKey;

    const simNodes: SimNode[] = nodes.map((n, i) => {
      const cached = hasCache ? layoutCache!.positions.get(n.id) : undefined;
      const angle = (2 * Math.PI * i) / N;
      const r = Math.min(width, height) * 0.35 * scaleFactor;
      return {
        ...n,
        x: cached?.x ?? (width / 2 + r * Math.cos(angle)),
        y: cached?.y ?? (height / 2 + r * Math.sin(angle)),
        vx: 0,
        vy: 0,
        radius: 6 + (n.score / maxScore) * 20,
      };
    });
    simNodesRef.current = simNodes;

    // Restore cached viewport or reset
    if (hasCache) {
      viewRef.current = { ...layoutCache!.view };
    } else {
      viewRef.current = { scale: 1, panX: 0, panY: 0 };
    }

    let tickCount = hasCache ? 999 : 0; // Skip auto-fit if restoring from cache
    const autoFitAt = 150;

    // Force simulation tick
    const tick = () => {
      const nodeCount = simNodes.length;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const dragNodeIdx = dragRef.current.nodeIndex;

      // Repulsion (all pairs)
      for (let i = 0; i < nodeCount; i++) {
        for (let j = i + 1; j < nodeCount; j++) {
          const dx = simNodes[i].x - simNodes[j].x;
          const dy = simNodes[i].y - simNodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = repulsion / (dist * dist);
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
        if (e.source >= nodeCount || e.target >= nodeCount) return;
        const s = simNodes[e.source];
        const t = simNodes[e.target];
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - edgeRestLength) * 0.005;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      });

      // Database clustering force — same-db nodes attract toward group centroid
      if (hasDatabases) {
        const dbGroups = new Map<string, SimNode[]>();
        simNodes.forEach((n) => {
          if (!n.database) return;
          let group = dbGroups.get(n.database);
          if (!group) { group = []; dbGroups.set(n.database, group); }
          group.push(n);
        });
        dbGroups.forEach((group) => {
          if (group.length < 2) return;
          let cx = 0, cy = 0;
          group.forEach((n) => { cx += n.x; cy += n.y; });
          cx /= group.length;
          cy /= group.length;
          group.forEach((n) => {
            n.vx += (cx - n.x) * 0.003;
            n.vy += (cy - n.y) * 0.003;
          });
        });
      }

      // Center gravity — pull toward container center
      const gravityStrength = 0.001;
      const centerX = w / 2;
      const centerY = h / 2;
      simNodes.forEach((n) => {
        n.vx += (centerX - n.x) * gravityStrength;
        n.vy += (centerY - n.y) * gravityStrength;
      });

      // Apply velocity — no hard boundary clamping, let the graph grow freely
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
      });

      // Auto-fit once after initial settling
      tickCount++;
      if (tickCount === autoFitAt) {
        fitToView();
      }

      // Update SVG elements directly for performance
      const svg = svgRef.current;
      if (!svg) return;

      // Update database hulls
      if (hasDatabases) {
        const dbGroups = new Map<string, SimNode[]>();
        simNodes.forEach((n) => {
          if (!n.database) return;
          let group = dbGroups.get(n.database);
          if (!group) { group = []; dbGroups.set(n.database, group); }
          group.push(n);
        });
        dbGroups.forEach((group, db) => {
          const hullPath = svg.querySelector<SVGPathElement>(`[data-hull="${db}"]`);
          const hullLabel = svg.querySelector<SVGTextElement>(`[data-hull-label="${db}"]`);
          if (!hullPath) return;
          // Compute centroid
          let cx = 0, cy = 0;
          group.forEach((n) => { cx += n.x; cy += n.y; });
          cx /= group.length;
          cy /= group.length;
          // Compute convex hull and pad it
          const points = group.map((n) => ({ x: n.x, y: n.y }));
          if (points.length < 3) {
            // For 1-2 nodes, draw a circle/ellipse-ish path around them
            const pad = 40;
            const d = points.length === 1
              ? `M ${cx - pad} ${cy} A ${pad} ${pad} 0 1 1 ${cx + pad} ${cy} A ${pad} ${pad} 0 1 1 ${cx - pad} ${cy} Z`
              : (() => {
                const dx = points[1].x - points[0].x;
                const dy = points[1].y - points[0].y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const nx = -dy / len * pad, ny = dx / len * pad;
                return `M ${points[0].x + nx} ${points[0].y + ny} L ${points[1].x + nx} ${points[1].y + ny} A ${pad} ${pad} 0 0 1 ${points[1].x - nx} ${points[1].y - ny} L ${points[0].x - nx} ${points[0].y - ny} A ${pad} ${pad} 0 0 1 ${points[0].x + nx} ${points[0].y + ny} Z`;
              })();
            hullPath.setAttribute('d', d);
          } else {
            const hull = padHull(convexHull(points), cx, cy, 30);
            const d = hull.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
            hullPath.setAttribute('d', d);
          }
          if (hullLabel) {
            hullLabel.setAttribute('x', String(cx));
            hullLabel.setAttribute('y', String(cy));
          }
        });
      }

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

      // Update viewport transform
      applyViewTransform();

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animRef.current);
      // Cache settled positions and viewport for instant restore on revisit
      const positions = new Map<string, { x: number; y: number }>();
      simNodes.forEach((n) => positions.set(n.id, { x: n.x, y: n.y }));
      layoutCache = { positions, view: { ...viewRef.current } };
      layoutCacheKey = cacheKey;
    };
  }, [nodes, edges, hasDatabases, applyViewTransform, fitToView]);

  // Mouse handlers for drag and pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x: mx, y: my } = screenToWorld(sx, sy);

      const simNodes = simNodesRef.current;
      let hitNode = false;
      for (let i = 0; i < simNodes.length; i++) {
        const n = simNodes[i];
        if (Math.hypot(mx - n.x, my - n.y) < n.radius + 5) {
          dragRef.current = { nodeIndex: i, offset: { x: mx - n.x, y: my - n.y }, isPan: false, panStart: { x: 0, y: 0 } };
          simNodes[i].fx = n.x;
          simNodes[i].fy = n.y;
          svg.style.cursor = 'grabbing';
          hitNode = true;
          break;
        }
      }
      // Pan on background drag
      if (!hitNode) {
        dragRef.current = { nodeIndex: null, offset: { x: 0, y: 0 }, isPan: true, panStart: { x: sx, y: sy } };

        svg.style.cursor = 'move';
      }
    },
    [screenToWorld],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // Panning
      if (dragRef.current.isPan) {
        const v = viewRef.current;
        const dx = sx - dragRef.current.panStart.x;
        const dy = sy - dragRef.current.panStart.y;
        v.panX += dx;
        v.panY += dy;
        dragRef.current.panStart = { x: sx, y: sy };
        applyViewTransform();
        return;
      }

      const { x: mx, y: my } = screenToWorld(sx, sy);
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
    [tooltip.visible, screenToWorld, applyViewTransform],
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
    dragRef.current = { nodeIndex: null, offset: { x: 0, y: 0 }, isPan: false, panStart: { x: 0, y: 0 } };
    if (svgRef.current) svgRef.current.style.cursor = 'default';
  }, []);

  const handleMouseLeave = useCallback(() => {
    handleMouseUp();
    setTooltip((t) => (t.visible ? { ...t, visible: false, node: null } : t));
    setHoveredNode(null);
  }, [handleMouseUp]);

  // Wheel zoom (centered on mouse position)
  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.scale * factor));
      // Zoom toward mouse position
      v.panX = sx - (sx - v.panX) * (newScale / v.scale);
      v.panY = sy - (sy - v.panY) * (newScale / v.scale);
      v.scale = newScale;
      applyViewTransform();
    },
    [applyViewTransform],
  );

  // Zoom button handlers
  const handleZoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    const v = viewRef.current;
    const newScale = Math.min(MAX_ZOOM, v.scale * ZOOM_STEP);
    v.panX = cx - (cx - v.panX) * (newScale / v.scale);
    v.panY = cy - (cy - v.panY) * (newScale / v.scale);
    v.scale = newScale;
    applyViewTransform();
  }, [applyViewTransform]);

  const handleZoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    const v = viewRef.current;
    const newScale = Math.max(MIN_ZOOM, v.scale / ZOOM_STEP);
    v.panX = cx - (cx - v.panX) * (newScale / v.scale);
    v.panY = cy - (cy - v.panY) * (newScale / v.scale);
    v.scale = newScale;
    applyViewTransform();
  }, [applyViewTransform]);

  const handleZoomReset = fitToView;

  // Fullscreen toggle
  const handleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  // Track fullscreen state changes
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

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
    <div ref={containerRef} className={`relative w-full h-full ${isFullscreen ? 'bg-bg-secondary' : ''}`}>
      <svg
        ref={svgRef}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
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
          <marker
            id="fg-arrow-crossdb"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff6b6b" />
          </marker>
        </defs>

        <g className="fg-viewport">
        {/* Database hulls (behind edges) */}
        {hasDatabases && (
          <g className="fg-hulls">
            {databases.map((db) => {
              const color = getDatabaseColor(db);
              return (
                <g key={db}>
                  <path
                    data-hull={db}
                    fill={color}
                    fillOpacity={0.1}
                    stroke={color}
                    strokeOpacity={0.3}
                    strokeWidth={1.5}
                    d=""
                  />
                  <text
                    data-hull-label={db}
                    fill={color}
                    fillOpacity={0.6}
                    fontSize={12}
                    fontWeight="bold"
                    textAnchor="middle"
                    dominantBaseline="central"
                    pointerEvents="none"
                  >
                    {db}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* Edges */}
        <g>
          {edges.map((e, i) => {
            const isHovered =
              hoveredNode !== null && (e.source === hoveredNode || e.target === hoveredNode);
            return (
              <line
                key={i}
                className="fg-edge"
                stroke={getEdgeStroke(e.type, e.crossDatabase)}
                strokeOpacity={isHovered ? 1 : e.crossDatabase ? 0.7 : 0.4}
                strokeWidth={getEdgeWidth(e.type, e.crossDatabase, isHovered)}
                strokeDasharray={getEdgeDash(e.type, e.crossDatabase)}
                markerEnd={e.crossDatabase ? 'url(#fg-arrow-crossdb)' : 'url(#fg-arrow)'}
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
        </g>{/* /fg-viewport */}
      </svg>

      {/* Zoom & fullscreen controls */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 flex items-center justify-center rounded bg-bg-primary/80 border border-border text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
          title="Zoom in"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </button>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 flex items-center justify-center rounded bg-bg-primary/80 border border-border text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
          title="Zoom out"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </button>
        <button
          onClick={handleZoomReset}
          className="w-8 h-8 flex items-center justify-center rounded bg-bg-primary/80 border border-border text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
          title="Fit to view"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3,2" />
            <polyline points="5,7 5,5 7,5" />
            <polyline points="11,9 11,11 9,11" />
          </svg>
        </button>
        <button
          onClick={handleFullscreen}
          className="w-8 h-8 flex items-center justify-center rounded bg-bg-primary/80 border border-border text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="6,2 6,6 2,6" />
              <polyline points="10,2 10,6 14,6" />
              <polyline points="6,14 6,10 2,10" />
              <polyline points="10,14 10,10 14,10" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="2,6 2,2 6,2" />
              <polyline points="14,6 14,2 10,2" />
              <polyline points="2,10 2,14 6,14" />
              <polyline points="14,10 14,14 10,14" />
            </svg>
          )}
        </button>
      </div>

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
          {tooltip.node.database && (
            <>
              <br />
              Database: {tooltip.node.database}
            </>
          )}
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
      <div className="absolute bottom-2 left-2 flex flex-wrap items-center gap-4 text-xs text-text-muted bg-bg-primary/80 rounded px-3 py-1.5 border border-border">
        <span>Drag nodes to rearrange. Hover for details. Node size = importance.</span>
        {legendItems.map((item) => (
          <span key={item.label} className="flex items-center gap-1">
            <span style={{ color: item.color }}>{item.symbol}</span> {item.label}
          </span>
        ))}
        {hasDatabases && (
          <>
            <span className="w-px h-3 bg-border" />
            {databases.map((db) => (
              <span key={db} className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: getDatabaseColor(db) }}
                />
                {db}
              </span>
            ))}
          </>
        )}
        {hasCrossDbEdges && (
          <>
            <span className="w-px h-3 bg-border" />
            <span className="flex items-center gap-1">
              <svg width="18" height="8" className="inline-block">
                <line x1="0" y1="4" x2="18" y2="4" stroke="#ff6b6b" strokeWidth="2" strokeDasharray="4,2" />
              </svg>
              Cross-DB
            </span>
          </>
        )}
      </div>
    </div>
  );
}

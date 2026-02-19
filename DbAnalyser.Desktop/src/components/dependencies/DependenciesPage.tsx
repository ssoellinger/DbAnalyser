import { useState, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../../hooks/useStore';
import { FilterBar } from '../shared/FilterBar';
import { GraphControls } from '../shared/GraphControls';
import { CycleWarning } from './CycleWarning';
import { getLayoutedElements } from '../../hooks/useDagreLayout';
import { detectCycles } from '../../hooks/useCycleDetection';
import { OBJECT_TYPE_COLORS } from '../../api/types';

function DependencyGraphInner() {
  const result = useStore((s) => s.result)!;
  const rels = result.relationships!;
  const deps = rels.dependencies;

  // Filters
  const nodeTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    deps.forEach((d) => { counts[d.objectType] = (counts[d.objectType] ?? 0) + 1; });
    return Object.entries(counts).map(([key, count]) => ({
      key: key.toLowerCase(),
      label: key + 's',
      count,
      color: OBJECT_TYPE_COLORS[key] ?? '#666',
    }));
  }, [deps]);

  const edgeTypes = useMemo(() => {
    const items = [
      { key: 'fk', label: 'FK', count: rels.explicitRelationships.length, color: '#4fc3f7' },
    ];
    const viewEdges = rels.viewDependencies.filter((d) => !d.isCrossDatabase);
    const byType: Record<string, number> = {};
    viewEdges.forEach((d) => { byType[d.fromType] = (byType[d.fromType] ?? 0) + 1; });
    Object.entries(byType).forEach(([type, count]) => {
      items.push({
        key: type.toLowerCase(),
        label: type,
        count,
        color: OBJECT_TYPE_COLORS[type] ?? '#666',
      });
    });
    const implicitHigh = rels.implicitRelationships.filter((r) => r.confidence >= 0.7).length;
    if (implicitHigh > 0) {
      items.push({ key: 'implicit', label: 'Implicit FK', count: implicitHigh, color: '#78909c' });
    }
    return items;
  }, [rels]);

  const [activeNodes, setActiveNodes] = useState(() => new Set(nodeTypes.map((t) => t.key)));
  const [activeEdges, setActiveEdges] = useState(() => new Set(edgeTypes.map((t) => t.key)));

  // Cycle detection
  const cycles = useMemo(() => detectCycles(deps), [deps]);
  const cycleNodes = useMemo(() => {
    const s = new Set<string>();
    cycles.forEach((c) => c.nodes.forEach((n) => s.add(n)));
    return s;
  }, [cycles]);

  // Build graph
  const { initialNodes, initialEdges } = useMemo(() => {
    const filteredDeps = deps.filter((d) => activeNodes.has(d.objectType.toLowerCase()));
    const nodeSet = new Set(filteredDeps.map((d) => d.fullName));

    const nodes: Node[] = filteredDeps.map((dep) => {
      const label = dep.fullName.split('.').pop() ?? dep.fullName;
      const estimatedWidth = Math.max(90, label.length * 7 + 20);
      return {
        id: dep.fullName,
        type: 'default',
        position: { x: 0, y: 0 },
        width: estimatedWidth,
        height: 36,
        data: { label },
        style: {
          background: OBJECT_TYPE_COLORS[dep.objectType] ?? '#666',
          color: '#fff',
          border: cycleNodes.has(dep.fullName) ? '2px solid #ff0' : 'none',
          borderRadius: '6px',
          padding: '6px 12px',
          fontSize: '11px',
          fontWeight: 500,
          width: estimatedWidth,
          textAlign: 'center' as const,
        },
      };
    });

    const edges: Edge[] = [];

    // FK edges
    if (activeEdges.has('fk')) {
      rels.explicitRelationships.forEach((fk, i) => {
        const from = `${fk.fromSchema}.${fk.fromTable}`;
        const to = `${fk.toSchema}.${fk.toTable}`;
        if (nodeSet.has(from) && nodeSet.has(to)) {
          edges.push({
            id: `fk-${i}`,
            source: from,
            target: to,
            style: { stroke: '#4fc3f7' },
            animated: false,
          });
        }
      });
    }

    // Object dependency edges
    rels.viewDependencies
      .filter((d) => !d.isCrossDatabase && activeEdges.has(d.fromType.toLowerCase()))
      .forEach((d, i) => {
        const from = `${d.fromSchema}.${d.fromName}`;
        const to = d.toFullName;
        if (nodeSet.has(from) && nodeSet.has(to)) {
          edges.push({
            id: `dep-${i}`,
            source: from,
            target: to,
            style: { stroke: OBJECT_TYPE_COLORS[d.fromType] ?? '#666', strokeDasharray: '5 3' },
          });
        }
      });

    // Implicit FK edges
    if (activeEdges.has('implicit')) {
      rels.implicitRelationships
        .filter((r) => r.confidence >= 0.7)
        .forEach((r, i) => {
          const from = `${r.fromSchema}.${r.fromTable}`;
          const to = `${r.toSchema}.${r.toTable}`;
          if (nodeSet.has(from) && nodeSet.has(to)) {
            edges.push({
              id: `impl-${i}`,
              source: from,
              target: to,
              style: { stroke: '#78909c', strokeDasharray: '2 4' },
            });
          }
        });
    }

    const laid = getLayoutedElements(nodes, edges, { rankSep: 25, nodeSep: 2 });
    return { initialNodes: laid.nodes, initialEdges: laid.edges };
  }, [deps, rels, activeNodes, activeEdges, cycleNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when filters change
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const { fitView } = useReactFlow();

  const handleAutoLayout = useCallback(() => {
    const laid = getLayoutedElements(nodes, edges, { rankSep: 25, nodeSep: 2 });
    setNodes(laid.nodes);
    setTimeout(() => fitView({ padding: 0.1 }), 50);
  }, [nodes, edges, setNodes, fitView]);

  const toggleNode = (key: string) => {
    setActiveNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleEdge = (key: string) => {
    setActiveEdges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-104px)] overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-text-primary">Dependency Graph</h2>
          <span className="text-xs text-text-muted">{nodes.length} objects</span>
        </div>
        <div className="flex items-center gap-2">
          {rels.implicitRelationships.length > 0 && (
            <div className="flex items-center gap-1.5 bg-severity-warning/10 border border-severity-warning/30 rounded-full px-3 py-1 text-xs text-severity-warning">
              {rels.implicitRelationships.length} missing FK{rels.implicitRelationships.length > 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      <CycleWarning cycles={cycles} />

      <div className="flex items-center gap-6 shrink-0">
        <FilterBar label="Objects" items={nodeTypes} active={activeNodes} onToggle={toggleNode} />
        <div className="w-px h-4 bg-border" />
        <FilterBar label="Relations" items={edgeTypes} active={activeEdges} onToggle={toggleEdge} />
      </div>

      <div className="flex-1 min-h-0 bg-bg-secondary border border-border rounded-lg relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0, maxZoom: 3 }}
          minZoom={0.1}
          maxZoom={3}
        >
          <Background />
          <GraphControls onAutoLayout={handleAutoLayout} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function DependenciesPage() {
  const rels = useStore((s) => s.result?.relationships);
  if (!rels || rels.dependencies.length === 0) {
    return <p className="text-text-muted">No dependency data available.</p>;
  }

  return (
    <ReactFlowProvider>
      <DependencyGraphInner />
    </ReactFlowProvider>
  );
}

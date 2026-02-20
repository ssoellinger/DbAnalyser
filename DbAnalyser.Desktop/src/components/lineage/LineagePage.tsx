import { useState, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { GraphControls } from '../shared/GraphControls';
import { AnalyzerLoader } from '../shared/AnalyzerLoader';
import { computeLineage } from '../../hooks/useLineage';
import { getLayoutedElements } from '../../hooks/useDagreLayout';
import { OBJECT_TYPE_COLORS } from '../../api/types';

function LineageGraphInner() {
  const result = useStore((s) => s.result)!;
  const rels = result.relationships!;
  const deps = rels.dependencies;

  const allObjects = useMemo(() => {
    const objects: { name: string; type: string }[] = [];
    deps.forEach((d) => objects.push({ name: d.fullName, type: d.objectType }));
    return objects;
  }, [deps]);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allObjects.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 10);
  }, [allObjects, query]);

  const typeMap = useMemo(() => {
    const m = new Map<string, string>();
    deps.forEach((d) => m.set(d.fullName, d.objectType));
    return m;
  }, [deps]);

  const lineage = useMemo(() => {
    if (!selected) return null;
    return computeLineage(selected, deps, rels.viewDependencies);
  }, [selected, deps, rels.viewDependencies]);

  const { graphNodes, graphEdges } = useMemo(() => {
    if (!lineage) return { graphNodes: [], graphEdges: [] };

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const addedNodes = new Set<string>();

    const addNode = (name: string, layer: number, side: 'upstream' | 'downstream' | 'center') => {
      if (addedNodes.has(name)) return;
      addedNodes.add(name);
      const type = typeMap.get(name) ?? 'Table';
      const color = OBJECT_TYPE_COLORS[type] ?? '#666';
      const isCenter = side === 'center';

      nodes.push({
        id: name,
        position: { x: 0, y: 0 },
        data: { label: name.split('.').pop() ?? name },
        style: {
          background: isCenter ? '#4fc3f7' : color,
          color: '#fff',
          border: isCenter ? '3px solid #fff' : 'none',
          borderRadius: '6px',
          padding: '6px 12px',
          fontSize: '11px',
          fontWeight: isCenter ? 700 : 500,
          minWidth: 100,
          textAlign: 'center' as const,
        },
      });
    };

    // Center node
    addNode(lineage.selected, 0, 'center');

    // Upstream nodes
    lineage.upstream.forEach((layerNodes, depth) => {
      layerNodes.forEach((name) => addNode(name, -depth, 'upstream'));
    });

    // Downstream nodes
    lineage.downstream.forEach((layerNodes, depth) => {
      layerNodes.forEach((name) => addNode(name, depth, 'downstream'));
    });

    // Edges from upstream to selected
    lineage.upstream.forEach((layerNodes) => {
      layerNodes.forEach((name) => {
        // Connect to selected or to closer upstream layer
        const dep = deps.find((d) => d.fullName === lineage.selected);
        if (dep && dep.dependsOn.includes(name)) {
          edges.push({
            id: `up-${name}-${lineage.selected}`,
            source: name,
            target: lineage.selected,
            style: { stroke: '#4fc3f7' },
          });
        }
      });
    });

    // Edges from selected to downstream
    lineage.downstream.forEach((layerNodes) => {
      layerNodes.forEach((name) => {
        const dep = deps.find((d) => d.fullName === name);
        if (dep && dep.dependsOn.includes(lineage.selected)) {
          edges.push({
            id: `down-${lineage.selected}-${name}`,
            source: lineage.selected,
            target: name,
            style: { stroke: '#4ecca3' },
          });
        }
      });
    });

    // General: build edges between all lineage nodes based on actual dependencies
    addedNodes.forEach((from) => {
      const dep = deps.find((d) => d.fullName === from);
      if (dep) {
        dep.dependsOn.forEach((to) => {
          if (addedNodes.has(to)) {
            const edgeId = `link-${from}-${to}`;
            if (!edges.find((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                source: to,
                target: from,
                style: { stroke: '#4fc3f7', strokeWidth: 1 },
              });
            }
          }
        });
      }
    });

    const laid = getLayoutedElements(nodes, edges, {
      direction: 'LR',
      rankSep: 40,
      nodeSep: 10,
    });
    return { graphNodes: laid.nodes, graphEdges: laid.edges };
  }, [lineage, deps, typeMap]);

  const [nodes, setNodes, onNodesChange] = useNodesState(graphNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphEdges);

  useMemo(() => {
    setNodes(graphNodes);
    setEdges(graphEdges);
  }, [graphNodes, graphEdges, setNodes, setEdges]);

  const handleAutoLayout = useCallback(() => {
    const laid = getLayoutedElements(nodes, edges, {
      direction: 'LR',
      rankSep: 40,
      nodeSep: 10,
    });
    setNodes(laid.nodes);
  }, [nodes, edges, setNodes]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">Data Lineage</h2>

      <div className="relative max-w-md">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); }}
          placeholder="Search for an object..."
          className="w-full bg-bg-card border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
        {suggestions.length > 0 && query.trim() && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded shadow-lg z-10 max-h-60 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.name}
                onClick={() => {
                  setSelected(s.name);
                  setQuery(s.name);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover text-sm transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: OBJECT_TYPE_COLORS[s.type] ?? '#666' }}
                />
                <span className="text-text-primary truncate">{s.name}</span>
                <span className="ml-auto text-xs text-text-muted">{s.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && lineage ? (
        <div className="space-y-2">
          <div className="flex gap-3 text-xs text-text-secondary">
            <span>Upstream: {Array.from(lineage.upstream.values()).flat().length} objects</span>
            <span>Downstream: {Array.from(lineage.downstream.values()).flat().length} objects</span>
          </div>
          <div className="h-[600px] bg-bg-secondary border border-border rounded-lg relative">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              fitView
              minZoom={0.1}
              maxZoom={3}
            >
              <Background />
              <GraphControls onAutoLayout={handleAutoLayout} />
            </ReactFlow>
          </div>
        </div>
      ) : (
        <div className="h-[400px] flex items-center justify-center bg-bg-secondary border border-border rounded-lg">
          <p className="text-text-muted text-sm">Select an object to view its data lineage</p>
        </div>
      )}
    </div>
  );
}

export function LineagePage() {
  const { status, error, refresh } = useAnalyzer('relationships');
  const rels = useStore((s) => s.result?.relationships);

  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="relationships">
      {rels && rels.dependencies.length > 0 ? (
        <ReactFlowProvider>
          <LineageGraphInner />
        </ReactFlowProvider>
      ) : (
        <p className="text-text-muted">No dependency data available for lineage.</p>
      )}
    </AnalyzerLoader>
  );
}

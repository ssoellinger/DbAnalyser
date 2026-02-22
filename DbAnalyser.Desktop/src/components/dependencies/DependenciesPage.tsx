import { useState, useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { FilterBar } from '../shared/FilterBar';
import { AnalyzerLoader } from '../shared/AnalyzerLoader';
import { CycleWarning } from './CycleWarning';
import { detectCycles } from '../../hooks/useCycleDetection';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { ForceGraph, type GraphNode, type GraphEdge } from './ForceGraph';

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

  // Build graph data for ForceGraph
  const { graphNodes, graphEdges } = useMemo(() => {
    const filteredDeps = deps.filter((d) => activeNodes.has(d.objectType.toLowerCase()));
    const nodeMap = new Map<string, number>();
    const gNodes: GraphNode[] = filteredDeps.map((d, i) => {
      nodeMap.set(d.fullName, i);
      return {
        id: d.fullName,
        label: d.fullName.split('.').pop() ?? d.fullName,
        type: d.objectType.toLowerCase(),
        refBy: d.referencedBy.length,
        depOn: d.dependsOn.length,
        impact: d.transitiveImpact.length,
        score: d.importanceScore,
        database: d.databaseName,
      };
    });

    const gEdges: GraphEdge[] = [];

    const isCrossDb = (si: number, ti: number): boolean => {
      const sDb = gNodes[si].database;
      const tDb = gNodes[ti].database;
      return !!sDb && !!tDb && sDb !== tDb;
    };

    // FK edges
    if (activeEdges.has('fk')) {
      rels.explicitRelationships.forEach((fk) => {
        const from = fk.fromDatabase
          ? `${fk.fromDatabase}.${fk.fromSchema}.${fk.fromTable}`
          : `${fk.fromSchema}.${fk.fromTable}`;
        const to = fk.toDatabase
          ? `${fk.toDatabase}.${fk.toSchema}.${fk.toTable}`
          : `${fk.toSchema}.${fk.toTable}`;
        const si = nodeMap.get(from);
        const ti = nodeMap.get(to);
        if (si !== undefined && ti !== undefined) {
          gEdges.push({ source: si, target: ti, type: 'fk', crossDatabase: isCrossDb(si, ti) });
        }
      });
    }

    // Object dependency edges (view deps)
    rels.viewDependencies
      .filter((d) => !d.isCrossDatabase && activeEdges.has(d.fromType.toLowerCase()))
      .forEach((d) => {
        const from = d.fromFullName ?? `${d.fromSchema}.${d.fromName}`;
        const to = d.toFullName;
        const si = nodeMap.get(from);
        const ti = nodeMap.get(to);
        if (si !== undefined && ti !== undefined) {
          gEdges.push({ source: si, target: ti, type: 'view', crossDatabase: isCrossDb(si, ti) });
        }
      });

    // Implicit FK edges
    if (activeEdges.has('implicit')) {
      rels.implicitRelationships
        .filter((r) => r.confidence >= 0.7)
        .forEach((r) => {
          const from = r.fromDatabase
            ? `${r.fromDatabase}.${r.fromSchema}.${r.fromTable}`
            : `${r.fromSchema}.${r.fromTable}`;
          const to = r.toDatabase
            ? `${r.toDatabase}.${r.toSchema}.${r.toTable}`
            : `${r.toSchema}.${r.toTable}`;
          const si = nodeMap.get(from);
          const ti = nodeMap.get(to);
          if (si !== undefined && ti !== undefined) {
            gEdges.push({ source: si, target: ti, type: 'implicit', crossDatabase: isCrossDb(si, ti) });
          }
        });
    }

    return { graphNodes: gNodes, graphEdges: gEdges };
  }, [deps, rels, activeNodes, activeEdges]);

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
          <span className="text-xs text-text-muted">{graphNodes.length} objects</span>
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
        <ForceGraph nodes={graphNodes} edges={graphEdges} />
      </div>
    </div>
  );
}

export function DependenciesPage() {
  const { status, error, progress, refresh } = useAnalyzer('relationships');
  const rels = useStore((s) => s.result?.relationships);

  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="relationships" progress={progress}>
      {rels && rels.dependencies.length > 0 ? (
        <DependencyGraphInner />
      ) : (
        <p className="text-text-muted">No dependency data available.</p>
      )}
    </AnalyzerLoader>
  );
}

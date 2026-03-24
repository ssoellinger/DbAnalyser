import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { AnalyzerLoader } from '../shared/AnalyzerLoader';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { useCodeStore } from '../code/useCodeStore';
import { generateTableDdl } from '../code/tableDdlGenerator';
import { ForceGraph, type GraphNode, type GraphEdge } from './ForceGraph';

function ExplorerInner() {
  const result = useStore((s) => s.result)!;
  const rels = result.relationships!;
  const deps = rels.dependencies;
  const schema = result.schema;
  const navigate = useNavigate();
  const openTab = useCodeStore((s) => s.openTab);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [depth, setDepth] = useState(1);

  // All searchable objects
  const allObjects = useMemo(() => {
    const objects: { name: string; type: string; connections: number }[] = [];
    deps.forEach((d) => objects.push({
      name: d.fullName,
      type: d.objectType,
      connections: d.dependsOn.length + d.referencedBy.length,
    }));
    return objects.sort((a, b) => b.connections - a.connections);
  }, [deps]);

  const suggestions = useMemo(() => {
    if (!dropdownOpen || !query.trim()) return [];
    const q = query.toLowerCase();
    return allObjects.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 15);
  }, [allObjects, query, dropdownOpen]);

  // Build adjacency maps
  const { forwardAdj, reverseAdj } = useMemo(() => {
    const fwd = new Map<string, Set<string>>();
    const rev = new Map<string, Set<string>>();
    deps.forEach((d) => {
      fwd.set(d.fullName, new Set(d.dependsOn));
      if (!rev.has(d.fullName)) rev.set(d.fullName, new Set());
      d.dependsOn.forEach((dep) => {
        if (!rev.has(dep)) rev.set(dep, new Set());
        rev.get(dep)!.add(d.fullName);
      });
    });
    rels.viewDependencies.forEach((od) => {
      const from = od.fromFullName;
      const to = od.toFullName;
      if (!fwd.has(from)) fwd.set(from, new Set());
      fwd.get(from)!.add(to);
      if (!rev.has(to)) rev.set(to, new Set());
      rev.get(to)!.add(from);
    });
    return { forwardAdj: fwd, reverseAdj: rev };
  }, [deps, rels.viewDependencies]);

  // Collect all nodes within N hops
  const neighborhood = useMemo(() => {
    if (!selected) return new Set<string>();
    const visited = new Set<string>();
    visited.add(selected);
    let frontier = [selected];

    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const neighbor of forwardAdj.get(node) ?? []) {
          if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor); }
        }
        for (const neighbor of reverseAdj.get(node) ?? []) {
          if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor); }
        }
      }
      frontier = next;
    }
    return visited;
  }, [selected, depth, forwardAdj, reverseAdj]);

  // Build graph data matching ForceGraph's expected format
  const { graphNodes, graphEdges, stats } = useMemo(() => {
    if (!selected || neighborhood.size === 0) return { graphNodes: [] as GraphNode[], graphEdges: [] as GraphEdge[], stats: null };

    const nodeList: GraphNode[] = [];
    const nodeIndexMap = new Map<string, number>();
    const edgeSeen = new Set<string>();

    // Create nodes
    for (const name of neighborhood) {
      const dep = deps.find((d) => d.fullName === name);
      const type = dep?.objectType ?? 'Table';
      nodeIndexMap.set(name, nodeList.length);
      nodeList.push({
        id: name,
        label: name.split('.').pop() ?? name,
        type: type.toLowerCase(),
        refBy: dep?.referencedBy.length ?? 0,
        depOn: dep?.dependsOn.length ?? 0,
        impact: dep?.transitiveImpact?.length ?? 0,
        score: dep?.importanceScore ?? 0,
        database: dep?.databaseName,
      });
    }

    // Create edges with numeric indices
    const edges: GraphEdge[] = [];
    for (const name of neighborhood) {
      const si = nodeIndexMap.get(name);
      if (si === undefined) continue;
      for (const to of forwardAdj.get(name) ?? []) {
        if (!neighborhood.has(to)) continue;
        const ti = nodeIndexMap.get(to);
        if (ti === undefined) continue;
        const key = `${si}-${ti}`;
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);
        edges.push({ source: si, target: ti, type: 'dependency' });
      }
    }

    // Stats for selected
    const dep = deps.find((d) => d.fullName === selected);
    const dependsOnCount = (forwardAdj.get(selected) ?? new Set()).size;
    const referencedByCount = (reverseAdj.get(selected) ?? new Set()).size;

    return {
      graphNodes: nodeList,
      graphEdges: edges,
      stats: {
        dependsOn: dependsOnCount,
        referencedBy: referencedByCount,
        totalConnections: dependsOnCount + referencedByCount,
        importanceScore: dep?.importanceScore ?? 0,
        transitiveImpact: dep?.transitiveImpact?.length ?? 0,
      },
    };
  }, [selected, neighborhood, forwardAdj, deps]);

  const openDetailPanel = useStore((s) => s.openDetailPanel);

  const handleNodeClick = useCallback((node: GraphNode) => {
    if (!schema) return;
    const fullName = node.id;
    if (schema.tables.some((t) => t.fullName === fullName)) openDetailPanel(fullName, 'Table');
    else if (schema.views.some((v) => v.fullName === fullName)) openDetailPanel(fullName, 'View');
  }, [schema, openDetailPanel]);

  const handleNodeDoubleClick = useCallback((node: GraphNode) => {
    if (!schema) return;
    const fullName = node.id;
    const table = schema.tables.find((t) => t.fullName === fullName);
    if (table) { openTab({ objectType: 'Table', fullName, label: table.tableName, definition: generateTableDdl(table) }); navigate('/code'); return; }
    const view = schema.views.find((v) => v.fullName === fullName);
    if (view) { openTab({ objectType: 'View', fullName, label: view.viewName, definition: view.definition ?? '' }); navigate('/code'); return; }
    const proc = schema.storedProcedures.find((p) => p.fullName === fullName);
    if (proc) { openTab({ objectType: 'Procedure', fullName, label: proc.procedureName, definition: proc.definition ?? '' }); navigate('/code'); return; }
    const func = schema.functions.find((f) => f.fullName === fullName);
    if (func) { openTab({ objectType: 'Function', fullName, label: func.functionName, definition: func.definition ?? '' }); navigate('/code'); return; }
    const trig = schema.triggers.find((t) => t.fullName === fullName);
    if (trig) { openTab({ objectType: 'Trigger', fullName, label: trig.triggerName, definition: trig.definition ?? '' }); navigate('/code'); }
  }, [schema, openTab, navigate]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-text-primary">Dependency Explorer</h2>

        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); }}
            onFocus={() => { if (query.trim()) setDropdownOpen(true); }}
            placeholder="Search for an object..."
            className="w-full bg-bg-card border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          {suggestions.length > 0 && dropdownOpen && (
            <>
              <div className="fixed inset-0 z-[5]" onClick={() => setDropdownOpen(false)} />
              <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded shadow-lg z-10 max-h-60 overflow-y-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => { setSelected(s.name); setQuery(s.name); setDropdownOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover text-sm transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: OBJECT_TYPE_COLORS[s.type] ?? '#666' }} />
                    <span className="text-text-primary truncate">{s.name}</span>
                    <span className="ml-auto text-xs text-text-muted">{s.connections} conn</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Depth selector */}
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          Depth:
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary"
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>{d} hop{d > 1 ? 's' : ''}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Stats bar */}
      {selected && stats && (
        <div className="flex items-center gap-4 text-xs bg-bg-card border border-border rounded px-4 py-2">
          <span className="font-medium text-text-primary">{selected}</span>
          <span className="text-text-muted">|</span>
          <span className="text-text-secondary">
            Depends on: <span className="font-medium text-blue-400">{stats.dependsOn}</span>
          </span>
          <span className="text-text-secondary">
            Used by: <span className="font-medium text-green-400">{stats.referencedBy}</span>
          </span>
          {stats.importanceScore > 0 && (
            <span className="text-text-secondary">
              Importance: <span className="font-medium text-amber-400">{stats.importanceScore.toFixed(1)}</span>
            </span>
          )}
          {stats.transitiveImpact > 0 && (
            <span className="text-text-secondary">
              Impact: <span className="font-medium text-red-400">{stats.transitiveImpact} objects</span>
            </span>
          )}
          <span className="text-text-muted ml-auto">{neighborhood.size} nodes</span>
        </div>
      )}

      {/* Graph */}
      {selected && graphNodes.length > 0 ? (
        <div className="h-[calc(100vh-280px)] bg-bg-secondary border border-border rounded-lg">
          <ForceGraph
            nodes={graphNodes}
            edges={graphEdges}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
          />
        </div>
      ) : (
        <div className="h-[400px] flex items-center justify-center bg-bg-secondary border border-border rounded-lg">
          <p className="text-text-muted text-sm">Search for an object to explore its dependencies</p>
        </div>
      )}
    </div>
  );
}

export function DependencyExplorerPage() {
  const { status, error, progress, refresh } = useAnalyzer('relationships');
  const rels = useStore((s) => s.result?.relationships);

  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="relationships" progress={progress}>
      {rels && rels.dependencies.length > 0 ? (
        <ExplorerInner />
      ) : (
        <p className="text-text-muted">No dependency data available.</p>
      )}
    </AnalyzerLoader>
  );
}

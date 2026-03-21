import { useMemo, useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { useCodeStore } from './useCodeStore';
import { generateTableDdl } from './tableDdlGenerator';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { TableDependency, ObjectDependency } from '../../api/types';

interface ExecutionChainPanelProps {
  fullName: string;
  objectType: string;
}

interface ChainNode {
  fullName: string;
  objectType: string;
  label: string;
  definition: string;
  depth: number;
  children: ChainNode[];
  isCycle?: boolean;
}

export function ExecutionChainPanel({ fullName, objectType }: ExecutionChainPanelProps) {
  const result = useStore((s) => s.result);
  const openTab = useCodeStore((s) => s.openTab);
  const [expanded, setExpanded] = useState(false);

  // Build object lookup
  const objectLookup = useMemo(() => {
    if (!result?.schema) return new Map<string, { fullName: string; objectType: string; label: string; definition: string }>();
    const schema = result.schema;
    const map = new Map<string, { fullName: string; objectType: string; label: string; definition: string }>();
    for (const t of schema.tables)
      map.set(t.fullName, { fullName: t.fullName, objectType: 'Table', label: t.tableName, definition: generateTableDdl(t) });
    for (const v of schema.views)
      map.set(v.fullName, { fullName: v.fullName, objectType: 'View', label: v.viewName, definition: v.definition ?? '' });
    for (const p of schema.storedProcedures)
      map.set(p.fullName, { fullName: p.fullName, objectType: 'Procedure', label: p.procedureName, definition: p.definition ?? '' });
    for (const f of schema.functions)
      map.set(f.fullName, { fullName: f.fullName, objectType: 'Function', label: f.functionName, definition: f.definition ?? '' });
    for (const t of schema.triggers)
      map.set(t.fullName, { fullName: t.fullName, objectType: 'Trigger', label: t.triggerName, definition: t.definition ?? '' });
    return map;
  }, [result?.schema]);

  // Build proc/function-only call graph
  const { callers, callees, hasCycles } = useMemo(() => {
    const deps = result?.relationships?.dependencies;
    const viewDeps = result?.relationships?.viewDependencies;
    if (!deps) return { callers: [] as ChainNode[], callees: [] as ChainNode[], hasCycles: false };

    const procTypes = new Set(['Procedure', 'Function']);

    // Build adjacency: who calls whom (filtered to procs/functions only)
    const callsMap = new Map<string, Set<string>>(); // from -> calls (dependsOn, filtered to procs/funcs)
    const calledByMap = new Map<string, Set<string>>(); // to -> called by

    for (const dep of deps) {
      if (!procTypes.has(dep.objectType)) continue;
      for (const target of dep.dependsOn) {
        const targetObj = objectLookup.get(target);
        if (!targetObj || !procTypes.has(targetObj.objectType)) continue;
        if (!callsMap.has(dep.fullName)) callsMap.set(dep.fullName, new Set());
        callsMap.get(dep.fullName)!.add(target);
        if (!calledByMap.has(target)) calledByMap.set(target, new Set());
        calledByMap.get(target)!.add(dep.fullName);
      }
    }

    // Also use viewDependencies for more complete picture
    if (viewDeps) {
      for (const od of viewDeps) {
        if (!procTypes.has(od.fromType)) continue;
        const targetObj = objectLookup.get(od.toFullName);
        if (!targetObj || !procTypes.has(targetObj.objectType)) continue;
        const from = od.fromFullName;
        if (!callsMap.has(from)) callsMap.set(from, new Set());
        callsMap.get(from)!.add(od.toFullName);
        if (!calledByMap.has(od.toFullName)) calledByMap.set(od.toFullName, new Set());
        calledByMap.get(od.toFullName)!.add(from);
      }
    }

    // Detect cycles
    let hasCycles = false;
    const visited = new Set<string>();
    const inStack = new Set<string>();

    function detectCycle(node: string): boolean {
      if (inStack.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      inStack.add(node);
      for (const child of callsMap.get(node) ?? []) {
        if (detectCycle(child)) return true;
      }
      inStack.delete(node);
      return false;
    }
    if (detectCycle(fullName)) hasCycles = true;

    // Build tree (BFS with depth limit)
    const maxDepth = 3;

    function buildTree(start: string, adj: Map<string, Set<string>>, depth: number, seen: Set<string>): ChainNode[] {
      if (depth >= maxDepth) return [];
      const neighbors = adj.get(start);
      if (!neighbors) return [];

      const nodes: ChainNode[] = [];
      for (const name of neighbors) {
        const obj = objectLookup.get(name);
        if (!obj) continue;
        const isCycle = seen.has(name);
        const newSeen = new Set(seen);
        newSeen.add(name);
        nodes.push({
          fullName: name,
          objectType: obj.objectType,
          label: obj.label,
          definition: obj.definition,
          depth: depth + 1,
          children: isCycle ? [] : buildTree(name, adj, depth + 1, newSeen),
          isCycle,
        });
      }
      return nodes.sort((a, b) => a.fullName.localeCompare(b.fullName));
    }

    const rootSeen = new Set([fullName]);
    const callers = buildTree(fullName, calledByMap, 0, rootSeen);
    const callees = buildTree(fullName, callsMap, 0, rootSeen);

    return { callers, callees, hasCycles };
  }, [fullName, result?.relationships?.dependencies, result?.relationships?.viewDependencies, objectLookup]);

  const total = callers.length + callees.length;
  if (total === 0) return null;

  function handleClick(node: ChainNode) {
    openTab({
      objectType: node.objectType,
      fullName: node.fullName,
      label: node.label,
      definition: node.definition,
    });
  }

  function renderTree(nodes: ChainNode[]): React.ReactNode {
    return nodes.map((node) => {
      const color = OBJECT_TYPE_COLORS[node.objectType] ?? '#666';
      return (
        <div key={node.fullName} className="ml-3">
          <button
            onClick={() => handleClick(node)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-text-secondary hover:text-text-primary hover:bg-bg-hover/50 transition-colors"
            title={`${node.fullName} (${node.objectType})`}
          >
            <span className="text-text-muted">{'\u251C'}</span>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span>{node.label}</span>
            {node.isCycle && <span className="text-severity-warning text-[9px]">(cycle)</span>}
          </button>
          {node.children.length > 0 && renderTree(node.children)}
        </div>
      );
    });
  }

  return (
    <div className="border-b border-border bg-bg-primary">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
      >
        <span>{expanded ? '\u25BE' : '\u25B8'}</span>
        <span>Call Chain</span>
        {callers.length > 0 && (
          <span className="px-1 rounded bg-bg-card">{callers.length} caller{callers.length !== 1 ? 's' : ''}</span>
        )}
        {callees.length > 0 && (
          <span className="px-1 rounded bg-bg-card">{callees.length} callee{callees.length !== 1 ? 's' : ''}</span>
        )}
        {hasCycles && <span className="text-severity-warning text-[9px]">has cycles</span>}
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {callers.length > 0 && (
            <div>
              <div className="text-[9px] text-text-muted uppercase tracking-wider mb-0.5">Callers (upstream)</div>
              {renderTree(callers)}
            </div>
          )}
          <div className="flex items-center gap-1 text-[10px] text-text-primary font-medium px-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: OBJECT_TYPE_COLORS[objectType] ?? '#666' }} />
            {fullName.split('.').pop()}
          </div>
          {callees.length > 0 && (
            <div>
              <div className="text-[9px] text-text-muted uppercase tracking-wider mb-0.5">Callees (downstream)</div>
              {renderTree(callees)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

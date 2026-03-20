import { useMemo, useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { UsageLevel } from '../../api/types';
import { useCodeStore, type ExplorerSort } from './useCodeStore';
import { generateTableDdl } from './tableDdlGenerator';

interface ObjectItem {
  objectType: string;
  fullName: string;
  label: string;
  definition: string;
  lastModified?: string | null;
  usageLevel?: UsageLevel;
  referencedBy: number;
}

const GROUP_ORDER = ['Tables', 'Views', 'Procedures', 'Functions', 'Triggers'];

const GROUP_ICONS: Record<string, string> = {
  Tables: '⊟',
  Views: '⊡',
  Procedures: '⊞',
  Functions: 'ƒ',
  Triggers: '⚡',
};

const USAGE_COLORS: Record<UsageLevel, string> = {
  active: '#4ecca3',
  low: '#f0a500',
  unused: '#e94560',
  unknown: '',
};

const USAGE_LABELS: Record<UsageLevel, string> = {
  active: 'Active',
  low: 'Low usage',
  unused: 'Unused',
  unknown: '',
};

function groupTypeKey(group: string): string {
  if (group === 'Procedures') return 'Procedure';
  if (group === 'Tables') return 'Table';
  if (group === 'Views') return 'View';
  if (group === 'Functions') return 'Function';
  return 'Trigger';
}

export function ObjectExplorer() {
  const result = useStore((s) => s.result);
  const filter = useCodeStore((s) => s.explorerFilter);
  const setFilter = useCodeStore((s) => s.setExplorerFilter);
  const collapsed = useCodeStore((s) => s.explorerCollapsed);
  const toggleGroup = useCodeStore((s) => s.toggleExplorerGroup);
  const explorerSort = useCodeStore((s) => s.explorerSort);
  const setExplorerSort = useCodeStore((s) => s.setExplorerSort);
  const openTab = useCodeStore((s) => s.openTab);

  // Build usage lookup
  const usageMap = useMemo(() => {
    if (!result?.usageAnalysis?.objects) return new Map<string, UsageLevel>();
    return new Map(result.usageAnalysis.objects.map((o) => [o.objectName, o.usageLevel]));
  }, [result?.usageAnalysis]);

  // Build "referenced by" counts — scan all definitions for references to each object
  const refCountMap = useMemo(() => {
    if (!result?.schema) return new Map<string, number>();
    const schema = result.schema;
    const counts = new Map<string, number>();

    // Collect all object names we want to count references for
    const allNames: string[] = [];
    for (const t of schema.tables) allNames.push(t.fullName);
    for (const v of schema.views) allNames.push(v.fullName);
    for (const p of schema.storedProcedures) allNames.push(p.fullName);
    for (const f of schema.functions) allNames.push(f.fullName);
    for (const t of schema.triggers) allNames.push(t.fullName);

    // Collect all definitions
    const allDefs: { fullName: string; definition: string }[] = [];
    for (const v of schema.views) if (v.definition) allDefs.push({ fullName: v.fullName, definition: v.definition });
    for (const p of schema.storedProcedures) if (p.definition) allDefs.push({ fullName: p.fullName, definition: p.definition });
    for (const f of schema.functions) if (f.definition) allDefs.push({ fullName: f.fullName, definition: f.definition });
    for (const t of schema.triggers) if (t.definition) allDefs.push({ fullName: t.fullName, definition: t.definition });

    for (const name of allNames) {
      const nameLower = name.toLowerCase();
      const shortName = name.split('.').pop()?.toLowerCase() ?? nameLower;
      let count = 0;
      for (const def of allDefs) {
        if (def.fullName === name) continue; // skip self
        const defLower = def.definition.toLowerCase();
        if (defLower.includes(nameLower) || defLower.includes(shortName)) {
          count++;
        }
      }
      if (count > 0) counts.set(name, count);
    }

    return counts;
  }, [result?.schema]);

  const groups = useMemo(() => {
    if (!result?.schema) return {};
    const schema = result.schema;
    const items: Record<string, ObjectItem[]> = {
      Tables: schema.tables.map((t) => ({
        objectType: 'Table',
        fullName: t.fullName,
        label: t.tableName,
        definition: generateTableDdl(t),
        usageLevel: usageMap.get(t.fullName),
        referencedBy: refCountMap.get(t.fullName) ?? 0,
      })),
      Views: schema.views.map((v) => ({
        objectType: 'View',
        fullName: v.fullName,
        label: v.viewName,
        definition: v.definition ?? '',
        lastModified: null,
        usageLevel: usageMap.get(v.fullName),
        referencedBy: refCountMap.get(v.fullName) ?? 0,
      })),
      Procedures: schema.storedProcedures.map((p) => ({
        objectType: 'Procedure',
        fullName: p.fullName,
        label: p.procedureName,
        definition: p.definition ?? '',
        lastModified: p.lastModified,
        usageLevel: usageMap.get(p.fullName),
        referencedBy: refCountMap.get(p.fullName) ?? 0,
      })),
      Functions: schema.functions.map((f) => ({
        objectType: 'Function',
        fullName: f.fullName,
        label: f.functionName,
        definition: f.definition ?? '',
        lastModified: f.lastModified,
        usageLevel: usageMap.get(f.fullName),
        referencedBy: refCountMap.get(f.fullName) ?? 0,
      })),
      Triggers: schema.triggers.map((t) => ({
        objectType: 'Trigger',
        fullName: t.fullName,
        label: t.triggerName,
        definition: t.definition ?? '',
        usageLevel: usageMap.get(t.fullName),
        referencedBy: refCountMap.get(t.fullName) ?? 0,
      })),
    };
    return items;
  }, [result, usageMap, refCountMap]);

  const filteredGroups = useMemo(() => {
    const base = filter.trim()
      ? Object.fromEntries(
          Object.entries(groups)
            .map(([group, items]) => [group, items.filter((item) => item.fullName.toLowerCase().includes(filter.toLowerCase()))])
            .filter(([, items]) => (items as ObjectItem[]).length > 0)
        ) as Record<string, ObjectItem[]>
      : groups;

    // Apply sort
    if (explorerSort === 'modified') {
      const sorted: Record<string, ObjectItem[]> = {};
      for (const [group, items] of Object.entries(base)) {
        sorted[group] = [...items].sort((a, b) => {
          if (!a.lastModified && !b.lastModified) return a.label.localeCompare(b.label);
          if (!a.lastModified) return 1;
          if (!b.lastModified) return -1;
          return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
        });
      }
      return sorted;
    }

    return base;
  }, [groups, filter, explorerSort]);

  const totalCount = useMemo(
    () => Object.values(groups).reduce((sum, items) => sum + items.length, 0),
    [groups]
  );

  const hasUsageData = usageMap.size > 0;

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-r border-border">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
            Explorer ({totalCount})
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExplorerSort('name')}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                explorerSort === 'name' ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-secondary'
              }`}
              title="Sort by name"
            >
              A-Z
            </button>
            <button
              onClick={() => setExplorerSort('modified')}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                explorerSort === 'modified' ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-secondary'
              }`}
              title="Sort by last modified"
            >
              Recent
            </button>
          </div>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter objects..."
          className="w-full px-2 py-1.5 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {GROUP_ORDER.filter((g) => filteredGroups[g]?.length).map((group) => {
          const items = filteredGroups[group]!;
          const isCollapsed = collapsed[group];
          const color = OBJECT_TYPE_COLORS[groupTypeKey(group)] ?? '#666';

          return (
            <div key={group}>
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <span className="text-[10px] text-text-muted w-3">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span style={{ color }}>{GROUP_ICONS[group]}</span>
                <span className="font-medium">{group}</span>
                <span className="ml-auto text-[10px] text-text-muted">{items.length}</span>
              </button>

              {!isCollapsed && (
                <div>
                  {items.map((item) => {
                    const usageColor = item.usageLevel ? USAGE_COLORS[item.usageLevel] : '';
                    const usageLabel = item.usageLevel ? USAGE_LABELS[item.usageLevel] : '';

                    return (
                      <button
                        key={item.fullName}
                        onClick={() =>
                          openTab({
                            objectType: item.objectType,
                            fullName: item.fullName,
                            label: item.label,
                            definition: item.definition,
                          })
                        }
                        className="w-full flex items-center gap-2 pl-8 pr-3 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors group"
                        title={usageLabel ? `${item.fullName} (${usageLabel})` : item.fullName}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate">{item.label}</span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {item.referencedBy > 0 && (
                            <span
                              className="text-[9px] px-1 rounded bg-bg-hover text-text-muted"
                              title={`Referenced by ${item.referencedBy} object${item.referencedBy !== 1 ? 's' : ''}`}
                            >
                              {item.referencedBy}
                            </span>
                          )}
                          {hasUsageData && usageColor && (
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: usageColor }}
                              title={usageLabel}
                            />
                          )}
                          {explorerSort === 'modified' && item.lastModified && (
                            <span className="text-[9px] text-text-muted">
                              {new Date(item.lastModified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {Object.keys(filteredGroups).length === 0 && (
          <p className="px-3 py-4 text-xs text-text-muted text-center">
            {filter ? 'No matching objects' : 'No schema data loaded'}
          </p>
        )}
      </div>

      {/* Usage legend */}
      {hasUsageData && (
        <div className="px-3 py-2 border-t border-border flex items-center gap-3 text-[10px] text-text-muted">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#4ecca3' }} /> Active</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#f0a500' }} /> Low</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#e94560' }} /> Unused</span>
        </div>
      )}
    </div>
  );
}

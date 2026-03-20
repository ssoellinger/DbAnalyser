import { useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { useCodeStore } from './useCodeStore';
import { generateTableDdl } from './tableDdlGenerator';

interface ObjectItem {
  objectType: string;
  fullName: string;
  label: string;
  definition: string;
  lastModified?: string | null;
}

const GROUP_ORDER = ['Tables', 'Views', 'Procedures', 'Functions', 'Triggers'];

const GROUP_ICONS: Record<string, string> = {
  Tables: '⊟',
  Views: '⊡',
  Procedures: '⊞',
  Functions: 'ƒ',
  Triggers: '⚡',
};

export function ObjectExplorer() {
  const result = useStore((s) => s.result);
  const filter = useCodeStore((s) => s.explorerFilter);
  const setFilter = useCodeStore((s) => s.setExplorerFilter);
  const collapsed = useCodeStore((s) => s.explorerCollapsed);
  const toggleGroup = useCodeStore((s) => s.toggleExplorerGroup);
  const openTab = useCodeStore((s) => s.openTab);

  const groups = useMemo(() => {
    if (!result?.schema) return {};
    const schema = result.schema;
    const items: Record<string, ObjectItem[]> = {
      Tables: schema.tables.map((t) => ({
        objectType: 'Table',
        fullName: t.fullName,
        label: t.tableName,
        definition: generateTableDdl(t),
      })),
      Views: schema.views.map((v) => ({
        objectType: 'View',
        fullName: v.fullName,
        label: v.viewName,
        definition: v.definition ?? '',
        lastModified: null,
      })),
      Procedures: schema.storedProcedures.map((p) => ({
        objectType: 'Procedure',
        fullName: p.fullName,
        label: p.procedureName,
        definition: p.definition ?? '',
        lastModified: p.lastModified,
      })),
      Functions: schema.functions.map((f) => ({
        objectType: 'Function',
        fullName: f.fullName,
        label: f.functionName,
        definition: f.definition ?? '',
        lastModified: f.lastModified,
      })),
      Triggers: schema.triggers.map((t) => ({
        objectType: 'Trigger',
        fullName: t.fullName,
        label: t.triggerName,
        definition: t.definition ?? '',
      })),
    };
    return items;
  }, [result]);

  const filteredGroups = useMemo(() => {
    if (!filter.trim()) return groups;
    const q = filter.toLowerCase();
    const filtered: Record<string, ObjectItem[]> = {};
    for (const [group, items] of Object.entries(groups)) {
      const matches = items.filter((item) => item.fullName.toLowerCase().includes(q));
      if (matches.length > 0) filtered[group] = matches;
    }
    return filtered;
  }, [groups, filter]);

  const totalCount = useMemo(
    () => Object.values(groups).reduce((sum, items) => sum + items.length, 0),
    [groups]
  );

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-r border-border">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border">
        <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
          Explorer ({totalCount})
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
          const color = OBJECT_TYPE_COLORS[group === 'Procedures' ? 'Procedure' : group === 'Tables' ? 'Table' : group === 'Views' ? 'View' : group === 'Functions' ? 'Function' : 'Trigger'] ?? '#666';

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
                  {items.map((item) => (
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
                      title={item.fullName}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="truncate">{item.label}</span>
                      {item.fullName.includes('.') && (
                        <span className="text-[10px] text-text-muted ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                          {item.fullName.split('.')[0]}
                        </span>
                      )}
                    </button>
                  ))}
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
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { useCodeStore } from './useCodeStore';
import { buildObjectLookup, type SchemaObject } from './schemaLookup';

interface DependencyMiniViewProps {
  fullName: string;
  objectType: string;
}

export function DependencyMiniView({ fullName, objectType }: DependencyMiniViewProps) {
  const result = useStore((s) => s.result);
  const openTab = useCodeStore((s) => s.openTab);
  const [expanded, setExpanded] = useState(false);

  const objectLookup = useMemo(() => buildObjectLookup(result?.schema ?? null), [result?.schema]);

  // Use API dependency data (pre-computed by the relationships analyzer)
  const { dependsOn, referencedBy } = useMemo(() => {
    const deps = result?.relationships?.dependencies;
    if (!deps) return { dependsOn: [], referencedBy: [] };

    const entry = deps.find((d) => d.fullName === fullName);
    if (!entry) return { dependsOn: [], referencedBy: [] };

    const dependsOn: SchemaObject[] = entry.dependsOn
      .map((name) => objectLookup.get(name))
      .filter((item): item is SchemaObject => !!item);

    const referencedBy: SchemaObject[] = entry.referencedBy
      .map((name) => objectLookup.get(name))
      .filter((item): item is SchemaObject => !!item);

    return { dependsOn, referencedBy };
  }, [fullName, result?.relationships?.dependencies, objectLookup]);

  const total = dependsOn.length + referencedBy.length;
  if (total === 0) return null;

  function handleClick(item: SchemaObject) {
    openTab({
      objectType: item.objectType,
      fullName: item.fullName,
      label: item.label,
      definition: item.definition,
    });
  }

  return (
    <div className="border-b border-border bg-bg-primary">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Dependencies</span>
        {dependsOn.length > 0 && (
          <span className="px-1 rounded bg-bg-card">{dependsOn.length} uses</span>
        )}
        {referencedBy.length > 0 && (
          <span className="px-1 rounded bg-bg-card">{referencedBy.length} used by</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          {dependsOn.length > 0 && (
            <div>
              <div className="text-[9px] text-text-muted uppercase tracking-wider mb-1">Uses ({dependsOn.length})</div>
              <div className="flex flex-wrap gap-1">
                {dependsOn.map((item) => {
                  const color = OBJECT_TYPE_COLORS[item.objectType] ?? '#666';
                  return (
                    <button
                      key={item.fullName}
                      onClick={() => handleClick(item)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-[10px] text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors"
                      title={`${item.fullName} (${item.objectType})`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {referencedBy.length > 0 && (
            <div>
              <div className="text-[9px] text-text-muted uppercase tracking-wider mb-1">Used by ({referencedBy.length})</div>
              <div className="flex flex-wrap gap-1">
                {referencedBy.map((item) => {
                  const color = OBJECT_TYPE_COLORS[item.objectType] ?? '#666';
                  return (
                    <button
                      key={item.fullName}
                      onClick={() => handleClick(item)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-[10px] text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors"
                      title={`${item.fullName} (${item.objectType})`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { useCodeStore } from './useCodeStore';
import { generateTableDdl } from './tableDdlGenerator';

interface DependencyMiniViewProps {
  fullName: string;
  objectType: string;
}

interface DepItem {
  fullName: string;
  objectType: string;
  label: string;
  definition: string;
}

export function DependencyMiniView({ fullName, objectType }: DependencyMiniViewProps) {
  const result = useStore((s) => s.result);
  const openTab = useCodeStore((s) => s.openTab);
  const [expanded, setExpanded] = useState(false);

  const { dependsOn, referencedBy } = useMemo(() => {
    if (!result?.schema) return { dependsOn: [], referencedBy: [] };
    const schema = result.schema;
    const nameLower = fullName.toLowerCase();
    const shortName = fullName.split('.').pop()?.toLowerCase() ?? nameLower;

    // Collect all objects with definitions
    const allObjects: DepItem[] = [];
    for (const t of schema.tables)
      allObjects.push({ fullName: t.fullName, objectType: 'Table', label: t.tableName, definition: generateTableDdl(t) });
    for (const v of schema.views)
      allObjects.push({ fullName: v.fullName, objectType: 'View', label: v.viewName, definition: v.definition ?? '' });
    for (const p of schema.storedProcedures)
      allObjects.push({ fullName: p.fullName, objectType: 'Procedure', label: p.procedureName, definition: p.definition ?? '' });
    for (const f of schema.functions)
      allObjects.push({ fullName: f.fullName, objectType: 'Function', label: f.functionName, definition: f.definition ?? '' });
    for (const t of schema.triggers)
      allObjects.push({ fullName: t.fullName, objectType: 'Trigger', label: t.triggerName, definition: t.definition ?? '' });

    // Find the current object's definition
    const currentObj = allObjects.find((o) => o.fullName === fullName);
    const currentDef = currentObj?.definition?.toLowerCase() ?? '';

    // dependsOn: objects whose names appear in the current object's definition
    const dependsOn: DepItem[] = [];
    for (const obj of allObjects) {
      if (obj.fullName === fullName) continue;
      const objLower = obj.fullName.toLowerCase();
      const objShort = obj.fullName.split('.').pop()?.toLowerCase() ?? objLower;
      if (currentDef.includes(objLower) || currentDef.includes(objShort)) {
        dependsOn.push(obj);
      }
    }

    // referencedBy: objects whose definitions mention the current object
    const referencedBy: DepItem[] = [];
    for (const obj of allObjects) {
      if (obj.fullName === fullName) continue;
      if (!obj.definition) continue;
      const defLower = obj.definition.toLowerCase();
      if (defLower.includes(nameLower) || defLower.includes(shortName)) {
        referencedBy.push(obj);
      }
    }

    return { dependsOn, referencedBy };
  }, [fullName, result?.schema]);

  const total = dependsOn.length + referencedBy.length;
  if (total === 0) return null;

  function handleClick(item: DepItem) {
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
          {/* Depends on */}
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

          {/* Referenced by */}
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

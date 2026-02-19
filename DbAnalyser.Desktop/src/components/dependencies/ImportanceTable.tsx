import { useState, useMemo } from 'react';
import { DataTable } from '../shared/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import type { TableDependency } from '../../api/types';

export function ImportanceTable({ dependencies }: { dependencies: TableDependency[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...dependencies].filter((d) => d.importanceScore > 0).sort((a, b) => b.importanceScore - a.importanceScore),
    [dependencies]
  );

  if (sorted.length === 0) return null;

  const columns: ColumnDef<TableDependency, any>[] = [
    {
      header: 'Object',
      accessorKey: 'fullName',
      cell: ({ row }) => (
        <button
          onClick={() => setExpanded(expanded === row.original.fullName ? null : row.original.fullName)}
          className="text-accent hover:text-accent-hover transition-colors"
        >
          {expanded === row.original.fullName ? '▾' : '▸'} {row.original.fullName}
        </button>
      ),
    },
    { header: 'Type', accessorKey: 'objectType' },
    { header: 'Score', accessorKey: 'importanceScore' },
    { header: 'Referenced By', accessorFn: (r) => r.referencedBy.length },
    { header: 'Depends On', accessorFn: (r) => r.dependsOn.length },
    { header: 'Transitive Impact', accessorFn: (r) => r.transitiveImpact.length },
  ];

  return (
    <div>
      <h3 className="text-sm font-medium text-text-secondary mb-2">Importance Rankings</h3>
      <DataTable data={sorted} columns={columns} searchPlaceholder="Filter objects..." />

      {expanded && (() => {
        const dep = dependencies.find((d) => d.fullName === expanded);
        if (!dep) return null;
        return (
          <div className="mt-3 bg-bg-card border border-border rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-medium text-text-primary">{dep.fullName} — Impact Analysis</h4>
            {dep.referencedBy.length > 0 && (
              <div>
                <p className="text-xs text-text-secondary mb-1">Referenced By ({dep.referencedBy.length}):</p>
                <div className="flex flex-wrap gap-1">
                  {dep.referencedBy.map((r) => (
                    <span key={r} className="text-xs bg-bg-hover rounded px-2 py-0.5 text-text-primary">{r}</span>
                  ))}
                </div>
              </div>
            )}
            {dep.dependsOn.length > 0 && (
              <div>
                <p className="text-xs text-text-secondary mb-1">Depends On ({dep.dependsOn.length}):</p>
                <div className="flex flex-wrap gap-1">
                  {dep.dependsOn.map((r) => (
                    <span key={r} className="text-xs bg-bg-hover rounded px-2 py-0.5 text-text-primary">{r}</span>
                  ))}
                </div>
              </div>
            )}
            {dep.transitiveImpact.length > 0 && (
              <div>
                <p className="text-xs text-text-secondary mb-1">Transitive Impact ({dep.transitiveImpact.length}):</p>
                <div className="flex flex-wrap gap-1">
                  {dep.transitiveImpact.map((r) => (
                    <span key={r} className="text-xs bg-bg-hover rounded px-2 py-0.5 text-text-primary">{r}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

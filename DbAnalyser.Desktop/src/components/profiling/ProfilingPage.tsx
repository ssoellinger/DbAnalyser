import { useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { DataTable } from '../shared/DataTable';
import { AnalyzerLoader, RefreshButton } from '../shared/AnalyzerLoader';
import type { ColumnDef } from '@tanstack/react-table';
import type { TableProfile, ColumnProfile } from '../../api/types';

export function ProfilingPage() {
  const { status, error, refresh } = useAnalyzer('profiling');
  const profiles = useStore((s) => s.result?.profiles);

  const sorted = useMemo(
    () => profiles ? [...profiles].sort((a, b) => b.rowCount - a.rowCount) : [],
    [profiles]
  );

  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="profiling">
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text-primary">Data Profiling</h2>
        <RefreshButton onClick={refresh} loading={status === 'loading'} />
      </div>

      {sorted.map((profile) => (
        <TableProfileCard key={profile.fullName} profile={profile} />
      ))}
    </div>
    </AnalyzerLoader>
  );
}

function TableProfileCard({ profile }: { profile: TableProfile }) {
  const columns: ColumnDef<ColumnProfile, any>[] = [
    { header: 'Column', accessorKey: 'columnName' },
    { header: 'Type', accessorKey: 'dataType' },
    { header: 'Total', accessorKey: 'totalCount', cell: ({ getValue }) => (getValue() as number).toLocaleString() },
    {
      header: 'Nulls',
      accessorKey: 'nullPercentage',
      cell: ({ row }) => {
        const pct = row.original.nullPercentage;
        const color = pct > 80 ? '#e94560' : pct > 50 ? '#f0a500' : pct > 20 ? '#4fc3f7' : '#4ecca3';
        return (
          <span style={{ color }}>
            {row.original.nullCount.toLocaleString()} ({pct.toFixed(1)}%)
          </span>
        );
      },
    },
    {
      header: 'Distinct',
      accessorKey: 'distinctCount',
      cell: ({ getValue }) => (getValue() as number).toLocaleString(),
    },
    { header: 'Min', accessorKey: 'minValue', cell: ({ getValue }) => truncate(getValue() as string | null) },
    { header: 'Max', accessorKey: 'maxValue', cell: ({ getValue }) => truncate(getValue() as string | null) },
  ];

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-text-primary">{profile.fullName}</h3>
        <span className="text-xs text-text-muted">{profile.rowCount.toLocaleString()} rows</span>
      </div>
      <DataTable
        data={profile.columnProfiles}
        columns={columns}
        searchable={false}
        pageSize={100}
      />
    </div>
  );
}

function truncate(value: string | null, max = 40): string {
  if (!value) return '—';
  return value.length > max ? value.substring(0, max) + '...' : value;
}

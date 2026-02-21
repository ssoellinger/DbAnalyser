import { useState, useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { DataTable } from '../shared/DataTable';
import { AnalyzerLoader, RefreshButton } from '../shared/AnalyzerLoader';
import type { ColumnDef } from '@tanstack/react-table';
import type { TableProfile, ColumnProfile } from '../../api/types';

export function ProfilingPage() {
  const isServerMode = useStore((s) => s.isServerMode);
  const { status, error, progress, refresh, cancel } = useAnalyzer('profiling', !isServerMode);
  const profiles = useStore((s) => s.result?.profiles);
  const databases = useStore(useShallow((s) => s.result?.databases ?? []));
  const runAnalyzer = useStore((s) => s.runAnalyzer);
  const [selectedDb, setSelectedDb] = useState('');

  const sorted = useMemo(
    () => profiles ? [...profiles].sort((a, b) => b.rowCount - a.rowCount) : [],
    [profiles]
  );

  const handleLoad = () => {
    if (selectedDb) {
      runAnalyzer('profiling', false, selectedDb);
    }
  };

  // Server mode: show DB picker instead of auto-loading
  if (isServerMode) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-text-primary">Data Profiling</h2>

        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-xs">
            <label className="block text-xs text-text-secondary mb-1">Database</label>
            <select
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
              className="w-full bg-bg-card border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent [&>option]:bg-bg-card [&>option]:text-text-primary"
            >
              <option value="">Select a database...</option>
              {databases.map((db) => (
                <option key={db} value={db}>{db}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleLoad}
            disabled={!selectedDb || status === 'loading'}
            className="px-4 py-2 rounded bg-accent text-bg-primary text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {status === 'loading' ? 'Loading...' : 'Load'}
          </button>
        </div>

        {status === 'loading' && (
          <AnalyzerLoader status={status} error={error} onRefresh={refresh} onCancel={cancel} analyzerName="profiling" progress={progress}>
            <div />
          </AnalyzerLoader>
        )}

        {error && (
          <p className="text-sm text-severity-error">{error}</p>
        )}

        {sorted.length > 0 ? (
          sorted.map((profile) => (
            <TableProfileCard key={profile.fullName} profile={profile} />
          ))
        ) : status !== 'loading' && profiles !== null && (
          <p className="text-text-muted text-sm">No profiling data loaded. Select a database and click Load.</p>
        )}
      </div>
    );
  }

  // Single-DB mode: auto-load as before
  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} onCancel={cancel} analyzerName="profiling" progress={progress}>
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

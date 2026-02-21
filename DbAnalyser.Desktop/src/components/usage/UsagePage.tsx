import { useState, useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { DataTable } from '../shared/DataTable';
import { AnalyzerLoader, RefreshButton } from '../shared/AnalyzerLoader';
import type { ColumnDef } from '@tanstack/react-table';
import type { ObjectUsage, UsageLevel } from '../../api/types';

const LEVEL_CONFIG: Record<UsageLevel, { color: string; icon: string; label: string }> = {
  active: { color: '#4ecca3', icon: '●', label: 'Active' },
  low: { color: '#f0a500', icon: '▲', label: 'Low' },
  unused: { color: '#e94560', icon: '○', label: 'Unused' },
  unknown: { color: '#78909c', icon: '?', label: 'Unknown' },
};

const LEVELS: UsageLevel[] = ['active', 'low', 'unused', 'unknown'];

export function UsagePage() {
  const isServerMode = useStore((s) => s.isServerMode);
  const { status, error, progress, refresh } = useAnalyzer('usage', !isServerMode);
  const usage = useStore((s) => s.result?.usageAnalysis);
  const databases = useStore((s) => s.result?.databases ?? []);
  const runAnalyzer = useStore((s) => s.runAnalyzer);
  const [selectedDb, setSelectedDb] = useState('');

  const handleLoad = () => {
    if (selectedDb) {
      runAnalyzer('usage', false, selectedDb);
    }
  };

  // Server mode: show DB picker instead of auto-loading
  if (isServerMode) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-text-primary">Usage Analysis</h2>

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
          <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="usage" progress={progress}>
            <div />
          </AnalyzerLoader>
        )}

        {error && (
          <p className="text-sm text-severity-error">{error}</p>
        )}

        {usage && usage.objects.length > 0 ? (
          <UsageContent usage={usage} refresh={refresh} isServerMode />
        ) : status !== 'loading' && usage !== null && (
          <p className="text-text-muted text-sm">No usage data loaded. Select a database and click Load.</p>
        )}
      </div>
    );
  }

  // Single-DB mode: auto-load as before
  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="usage" progress={progress}>
      {usage ? (
        <UsageContent usage={usage} refresh={refresh} />
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-text-primary">Usage</h2>
          <p className="text-text-muted">No usage analysis available.</p>
        </div>
      )}
    </AnalyzerLoader>
  );
}

function UsageContent({ usage, refresh, isServerMode }: { usage: import('../../api/types').UsageAnalysis; refresh: () => void; isServerMode?: boolean }) {
  const [filter, setFilter] = useState<UsageLevel | 'all'>('all');
  const analyzerStatus = useStore((s) => s.analyzerStatus.usage);

  const counts = useMemo(() => {
    const c = { active: 0, low: 0, unused: 0, unknown: 0 };
    usage.objects.forEach((o) => c[o.usageLevel]++);
    return c;
  }, [usage]);

  const filtered = useMemo(() => {
    if (filter === 'all') return usage.objects;
    return usage.objects.filter((o) => o.usageLevel === filter);
  }, [usage, filter]);

  const columns: ColumnDef<ObjectUsage, any>[] = [
    { header: 'Name', accessorKey: 'objectName' },
    { header: 'Type', accessorKey: 'objectType' },
    {
      header: 'Usage',
      accessorKey: 'usageLevel',
      cell: ({ getValue }) => {
        const level = getValue() as UsageLevel;
        const cfg = LEVEL_CONFIG[level];
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ color: cfg.color, backgroundColor: `${cfg.color}18` }}
          >
            {cfg.icon} {cfg.label}
          </span>
        );
      },
    },
    {
      header: 'Score',
      accessorKey: 'score',
      cell: ({ getValue }) => {
        const score = getValue() as number;
        const color = score >= 0.3 ? '#4ecca3' : score >= -0.3 ? '#f0a500' : '#e94560';
        return <span style={{ color }}>{score.toFixed(3)}</span>;
      },
    },
    {
      header: 'Evidence',
      accessorKey: 'evidence',
      cell: ({ getValue }) => {
        const evidence = getValue() as string[];
        if (evidence.length === 0) return <span className="text-text-muted">-</span>;
        return (
          <ul className="list-disc list-inside text-xs space-y-0.5">
            {evidence.map((e, i) => (
              <li key={i} className="text-text-secondary">
                {e}
              </li>
            ))}
          </ul>
        );
      },
      enableSorting: false,
    },
  ];

  return (
    <div className="space-y-6">
      {!isServerMode && (
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-text-primary">Usage Analysis</h2>
            <RefreshButton onClick={refresh} loading={analyzerStatus === 'loading'} />
          </div>
          {usage.serverUptimeDays != null && (
            <p className="text-xs text-text-muted mt-1">
              Server uptime: {usage.serverUptimeDays} days
              {usage.serverStartTime && (
                <> (since {new Date(usage.serverStartTime).toLocaleDateString()})</>
              )}
            </p>
          )}
        </div>
      )}

      {isServerMode && usage.serverUptimeDays != null && (
        <p className="text-xs text-text-muted">
          Server uptime: {usage.serverUptimeDays} days
          {usage.serverStartTime && (
            <> (since {new Date(usage.serverStartTime).toLocaleDateString()})</>
          )}
        </p>
      )}

      {/* Summary cards */}
      <div className="flex gap-3 flex-wrap">
        {LEVELS.map((level) => {
          const cfg = LEVEL_CONFIG[level];
          const count = counts[level];
          if (count === 0) return null;
          return (
            <button
              key={level}
              onClick={() => setFilter(filter === level ? 'all' : level)}
              className={`bg-bg-card border rounded-lg px-4 py-3 flex items-center gap-2 transition-colors ${
                filter === level ? 'border-accent' : 'border-border hover:border-accent/50'
              }`}
            >
              <span style={{ color: cfg.color }} className="text-lg">
                {cfg.icon}
              </span>
              <div className="text-left">
                <p className="text-lg font-bold text-text-primary">{count}</p>
                <p className="text-xs text-text-secondary">{cfg.label}</p>
              </div>
            </button>
          );
        })}
        {filter !== 'all' && (
          <button
            onClick={() => setFilter('all')}
            className="self-center text-xs text-text-muted hover:text-text-primary transition-colors underline"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Data table */}
      <DataTable data={filtered} columns={columns} searchPlaceholder="Filter objects..." />
    </div>
  );
}

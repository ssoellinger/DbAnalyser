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
  const { status, error, refresh } = useAnalyzer('usage');
  const usage = useStore((s) => s.result?.usageAnalysis);

  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="usage">
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

function UsageContent({ usage, refresh }: { usage: import('../../api/types').UsageAnalysis; refresh: () => void }) {
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

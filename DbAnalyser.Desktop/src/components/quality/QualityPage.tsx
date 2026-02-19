import { useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { DataTable } from '../shared/DataTable';
import { AnalyzerLoader, RefreshButton } from '../shared/AnalyzerLoader';
import type { ColumnDef } from '@tanstack/react-table';
import type { QualityIssue, IssueSeverity } from '../../api/types';

const SEVERITY_CONFIG: Record<IssueSeverity, { color: string; icon: string; label: string }> = {
  error: { color: '#e94560', icon: '●', label: 'Errors' },
  warning: { color: '#f0a500', icon: '▲', label: 'Warnings' },
  info: { color: '#4fc3f7', icon: 'ℹ', label: 'Info' },
};

export function QualityPage() {
  const { status, error, refresh } = useAnalyzer('quality');
  const issues = useStore((s) => s.result?.qualityIssues);

  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="quality">
      <QualityContent issues={issues ?? []} refresh={refresh} loading={status === 'loading'} />
    </AnalyzerLoader>
  );
}

function QualityContent({ issues, refresh, loading }: { issues: QualityIssue[]; refresh: () => void; loading: boolean }) {
  const grouped = useMemo(() => {
    const groups: Record<IssueSeverity, QualityIssue[]> = {
      error: [],
      warning: [],
      info: [],
    };
    issues.forEach((i) => groups[i.severity].push(i));
    return groups;
  }, [issues]);

  if (issues.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">Quality</h2>
          <RefreshButton onClick={refresh} loading={loading} />
        </div>
        <p className="text-text-muted">No quality issues detected.</p>
      </div>
    );
  }

  const columns: ColumnDef<QualityIssue, any>[] = [
    {
      header: 'Severity',
      accessorKey: 'severity',
      cell: ({ getValue }) => {
        const s = getValue() as IssueSeverity;
        const cfg = SEVERITY_CONFIG[s];
        return (
          <span className="flex items-center gap-1.5" style={{ color: cfg.color }}>
            {cfg.icon} {s}
          </span>
        );
      },
    },
    { header: 'Category', accessorKey: 'category' },
    { header: 'Object', accessorKey: 'objectName' },
    { header: 'Description', accessorKey: 'description' },
    {
      header: 'Recommendation',
      accessorKey: 'recommendation',
      cell: ({ getValue }) => getValue() ?? '—',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text-primary">Quality</h2>
        <RefreshButton onClick={refresh} loading={loading} />
      </div>

      <div className="flex gap-3">
        {(Object.entries(SEVERITY_CONFIG) as [IssueSeverity, typeof SEVERITY_CONFIG.error][]).map(
          ([sev, cfg]) => {
            const count = grouped[sev].length;
            if (count === 0) return null;
            return (
              <div
                key={sev}
                className="bg-bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-2"
              >
                <span style={{ color: cfg.color }} className="text-lg">
                  {cfg.icon}
                </span>
                <div>
                  <p className="text-lg font-bold text-text-primary">{count}</p>
                  <p className="text-xs text-text-secondary">{cfg.label}</p>
                </div>
              </div>
            );
          }
        )}
      </div>

      {(['error', 'warning', 'info'] as IssueSeverity[]).map((sev) => {
        const group = grouped[sev];
        if (group.length === 0) return null;
        const cfg = SEVERITY_CONFIG[sev];
        return (
          <div key={sev}>
            <h3 className="text-sm font-medium mb-2" style={{ color: cfg.color }}>
              {cfg.icon} {cfg.label} ({group.length})
            </h3>
            <DataTable data={group} columns={columns} searchPlaceholder="Filter issues..." />
          </div>
        );
      })}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { DataTable } from '../shared/DataTable';
import { AnalyzerLoader, RefreshButton } from '../shared/AnalyzerLoader';
import type { ColumnDef } from '@tanstack/react-table';
import type { IndexRecommendation, IndexInventoryItem } from '../../api/types';

type Severity = 'error' | 'warning' | 'info';
type Tab = 'inventory' | 'recommendations';

const SEVERITY_CONFIG: Record<Severity, { color: string; icon: string; label: string }> = {
  error: { color: '#e94560', icon: '●', label: 'Errors' },
  warning: { color: '#f0a500', icon: '▲', label: 'Warnings' },
  info: { color: '#4fc3f7', icon: 'ℹ', label: 'Info' },
};

export function IndexingPage() {
  const isServerMode = useStore((s) => s.isServerMode);
  const { status, error, progress, refresh, cancel } = useAnalyzer('indexing', !isServerMode);
  const recommendations = useStore((s) => s.result?.indexRecommendations);
  const inventory = useStore((s) => s.result?.indexInventory);
  const databases = useStore(useShallow((s) => s.result?.databases ?? []));
  const runAnalyzer = useStore((s) => s.runAnalyzer);
  const [selectedDb, setSelectedDb] = useState('');

  const handleLoad = () => {
    if (selectedDb) {
      runAnalyzer('indexing', false, selectedDb);
    }
  };

  // Server mode: show DB picker
  if (isServerMode) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-text-primary">Indexing</h2>

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
          <AnalyzerLoader status={status} error={error} onRefresh={refresh} onCancel={cancel} analyzerName="indexing" progress={progress}>
            <div />
          </AnalyzerLoader>
        )}

        {error && (
          <p className="text-sm text-severity-error">{error}</p>
        )}

        {inventory && inventory.length > 0 ? (
          <IndexingContent
            recommendations={recommendations ?? []}
            inventory={inventory}
            refresh={refresh}
            loading={status === 'loading'}
            isServerMode
          />
        ) : status !== 'loading' && inventory !== null && (
          <p className="text-text-muted text-sm">No indexing data loaded. Select a database and click Load.</p>
        )}
      </div>
    );
  }

  // Single-DB mode: auto-load
  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} onCancel={cancel} analyzerName="indexing" progress={progress}>
      <IndexingContent
        recommendations={recommendations ?? []}
        inventory={inventory ?? []}
        refresh={refresh}
        loading={status === 'loading'}
      />
    </AnalyzerLoader>
  );
}

function IndexingContent({
  recommendations,
  inventory,
  refresh,
  loading,
  isServerMode,
}: {
  recommendations: IndexRecommendation[];
  inventory: IndexInventoryItem[];
  refresh: () => void;
  loading: boolean;
  isServerMode?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('inventory');

  return (
    <div className="space-y-6">
      {!isServerMode && (
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-primary">Indexing</h2>
          <RefreshButton onClick={refresh} loading={loading} />
        </div>
      )}

      {/* Summary cards */}
      <div className="flex gap-3 flex-wrap">
        <div className="bg-bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-lg font-bold text-text-primary">{inventory.length}</p>
          <p className="text-xs text-text-secondary">Total Indexes</p>
        </div>
        <div className="bg-bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-lg font-bold text-text-primary">{inventory.filter((i) => i.isClustered).length}</p>
          <p className="text-xs text-text-secondary">Clustered</p>
        </div>
        <div className="bg-bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-lg font-bold text-text-primary">{inventory.filter((i) => !i.isClustered).length}</p>
          <p className="text-xs text-text-secondary">Non-Clustered</p>
        </div>
        {recommendations.length > 0 && (
          <div className="bg-bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-lg font-bold text-severity-warning">{recommendations.length}</p>
            <p className="text-xs text-text-secondary">Recommendations</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === 'inventory'} onClick={() => setTab('inventory')}>
          All Indexes ({inventory.length})
        </TabButton>
        <TabButton active={tab === 'recommendations'} onClick={() => setTab('recommendations')}>
          Recommendations ({recommendations.length})
        </TabButton>
      </div>

      {tab === 'inventory' ? (
        <InventoryTab inventory={inventory} />
      ) : (
        <RecommendationsTab recommendations={recommendations} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? 'text-accent border-accent'
          : 'text-text-secondary border-transparent hover:text-text-primary hover:border-border'
      }`}
    >
      {children}
    </button>
  );
}

function formatSize(kb: number): string {
  if (kb === 0) return '—';
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
}

function InventoryTab({ inventory }: { inventory: IndexInventoryItem[] }) {
  const columns: ColumnDef<IndexInventoryItem, any>[] = useMemo(
    () => [
      {
        header: 'Table',
        accessorFn: (row) => `${row.schemaName}.${row.tableName}`,
      },
      { header: 'Index Name', accessorKey: 'indexName' },
      {
        header: 'Type',
        accessorFn: (row) => {
          const parts: string[] = [];
          if (row.isClustered) parts.push('Clustered');
          else parts.push('Non-Clustered');
          if (row.isUnique) parts.push('Unique');
          return parts.join(', ');
        },
      },
      { header: 'Columns', accessorKey: 'columns' },
      {
        header: 'Seeks',
        accessorKey: 'userSeeks',
        cell: ({ getValue }) => (getValue() as number).toLocaleString(),
      },
      {
        header: 'Scans',
        accessorKey: 'userScans',
        cell: ({ getValue }) => (getValue() as number).toLocaleString(),
      },
      {
        header: 'Lookups',
        accessorKey: 'userLookups',
        cell: ({ getValue }) => (getValue() as number).toLocaleString(),
      },
      {
        header: 'Updates',
        accessorKey: 'userUpdates',
        cell: ({ getValue }) => (getValue() as number).toLocaleString(),
      },
      {
        header: 'Size',
        accessorKey: 'sizeKB',
        cell: ({ getValue }) => formatSize(getValue() as number),
      },
    ],
    []
  );

  if (inventory.length === 0) {
    return <p className="text-text-muted">No indexes found.</p>;
  }

  return <DataTable data={inventory} columns={columns} searchPlaceholder="Filter indexes..." />;
}

function RecommendationsTab({ recommendations }: { recommendations: IndexRecommendation[] }) {
  const grouped = useMemo(() => {
    const bySeverity: Record<Severity, IndexRecommendation[]> = {
      error: [],
      warning: [],
      info: [],
    };
    recommendations.forEach((r) => {
      const sev = r.severity as Severity;
      if (bySeverity[sev]) bySeverity[sev].push(r);
    });
    // Sort by impact score descending within each group
    for (const group of Object.values(bySeverity)) {
      group.sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
    }
    return bySeverity;
  }, [recommendations]);

  const columns: ColumnDef<IndexRecommendation, any>[] = [
    {
      header: 'Severity',
      accessorKey: 'severity',
      cell: ({ getValue }) => {
        const s = getValue() as Severity;
        const cfg = SEVERITY_CONFIG[s];
        if (!cfg) return s;
        return (
          <span className="flex items-center gap-1.5" style={{ color: cfg.color }}>
            {cfg.icon} {s}
          </span>
        );
      },
    },
    { header: 'Category', accessorKey: 'category' },
    {
      header: 'Table',
      accessorFn: (row) => `${row.schemaName}.${row.tableName}`,
    },
    { header: 'Description', accessorKey: 'description' },
    {
      header: 'Impact',
      accessorKey: 'impactScore',
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—';
      },
    },
    {
      header: 'Recommendation',
      accessorKey: 'recommendation',
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v) return '—';
        return <code className="text-xs bg-bg-hover px-1.5 py-0.5 rounded break-all">{v}</code>;
      },
    },
  ];

  if (recommendations.length === 0) {
    return <p className="text-text-muted">No index recommendations found.</p>;
  }

  return (
    <div className="space-y-4">
      {(['error', 'warning', 'info'] as Severity[]).map((sev) => {
        const group = grouped[sev];
        if (group.length === 0) return null;
        const cfg = SEVERITY_CONFIG[sev];
        return (
          <div key={sev}>
            <h3 className="text-sm font-medium mb-2" style={{ color: cfg.color }}>
              {cfg.icon} {cfg.label} ({group.length})
            </h3>
            <DataTable data={group} columns={columns} searchPlaceholder="Filter recommendations..." />
          </div>
        );
      })}
    </div>
  );
}

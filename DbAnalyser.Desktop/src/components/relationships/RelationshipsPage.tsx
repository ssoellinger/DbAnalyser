import { useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { DataTable } from '../shared/DataTable';
import { AnalyzerLoader, RefreshButton } from '../shared/AnalyzerLoader';
import type { ColumnDef } from '@tanstack/react-table';
import type { ForeignKeyInfo, ObjectDependency, ImplicitRelationship } from '../../api/types';

type TabKey = 'fks' | 'dependencies' | 'implicit';

export function RelationshipsPage() {
  const { status, error, progress, refresh } = useAnalyzer('relationships');
  const rels = useStore((s) => s.result?.relationships);
  const [activeTab, setActiveTab] = useState<TabKey>('fks');

  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="relationships" progress={progress}>
      <RelationshipsContent rels={rels!} activeTab={activeTab} setActiveTab={setActiveTab} refresh={refresh} loading={status === 'loading'} />
    </AnalyzerLoader>
  );
}

function RelationshipsContent({ rels, activeTab, setActiveTab, refresh, loading }: {
  rels: import('../../api/types').RelationshipMap;
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  refresh: () => void;
  loading: boolean;
}) {
  const tabs = ([
    { key: 'fks' as TabKey, label: 'Foreign Keys', count: rels.explicitRelationships.length },
    { key: 'dependencies' as TabKey, label: 'Object Dependencies', count: rels.viewDependencies.length },
    { key: 'implicit' as TabKey, label: 'Implicit Relationships', count: rels.implicitRelationships.length },
  ]).filter((t) => t.count > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text-primary">Relationships</h2>
        <RefreshButton onClick={refresh} loading={loading} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-t text-xs transition-colors ${
              activeTab === tab.key
                ? 'bg-bg-card text-accent border border-border border-b-0'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {activeTab === 'fks' && <ForeignKeysTab data={rels.explicitRelationships} />}
      {activeTab === 'dependencies' && <DependenciesTab data={rels.viewDependencies} />}
      {activeTab === 'implicit' && <ImplicitTab data={rels.implicitRelationships} />}
    </div>
  );
}

function ForeignKeysTab({ data }: { data: ForeignKeyInfo[] }) {
  const columns: ColumnDef<ForeignKeyInfo, any>[] = [
    { header: 'Name', accessorKey: 'name' },
    { header: 'From', accessorFn: (r) => {
      const prefix = r.fromDatabase ? `${r.fromDatabase}.` : '';
      return `${prefix}${r.fromSchema}.${r.fromTable}.${r.fromColumn}`;
    }},
    { header: 'To', accessorFn: (r) => {
      const prefix = r.toDatabase ? `${r.toDatabase}.` : '';
      return `${prefix}${r.toSchema}.${r.toTable}.${r.toColumn}`;
    }},
    { header: 'Delete Rule', accessorKey: 'deleteRule' },
    { header: 'Update Rule', accessorKey: 'updateRule' },
  ];
  return <DataTable data={data} columns={columns} searchPlaceholder="Filter foreign keys..." />;
}

function DependenciesTab({ data }: { data: ObjectDependency[] }) {
  const columns: ColumnDef<ObjectDependency, any>[] = [
    { header: 'From', accessorFn: (r) => r.fromFullName ?? `${r.fromSchema}.${r.fromName}` },
    { header: 'From Type', accessorKey: 'fromType' },
    { header: 'To', accessorKey: 'toFullName' },
    { header: 'To Type', accessorKey: 'toType' },
    {
      header: 'Cross-DB',
      accessorKey: 'isCrossDatabase',
      cell: ({ getValue }) => getValue() ? 'Yes' : '',
    },
  ];
  return <DataTable data={data} columns={columns} searchPlaceholder="Filter dependencies..." />;
}

function ImplicitTab({ data }: { data: ImplicitRelationship[] }) {
  const columns: ColumnDef<ImplicitRelationship, any>[] = [
    { header: 'From', accessorFn: (r) => {
      const prefix = r.fromDatabase ? `${r.fromDatabase}.` : '';
      return `${prefix}${r.fromSchema}.${r.fromTable}.${r.fromColumn}`;
    }},
    { header: 'To', accessorFn: (r) => {
      const prefix = r.toDatabase ? `${r.toDatabase}.` : '';
      return `${prefix}${r.toSchema}.${r.toTable}.${r.toColumn}`;
    }},
    {
      header: 'Confidence',
      accessorKey: 'confidence',
      cell: ({ getValue }) => {
        const c = getValue() as number;
        const color = c >= 0.8 ? '#4ecca3' : c >= 0.7 ? '#f0a500' : '#e94560';
        return <span style={{ color }}>{(c * 100).toFixed(0)}%</span>;
      },
    },
    { header: 'Reason', accessorKey: 'reason' },
    {
      header: 'SQL',
      id: 'sql',
      cell: ({ row }) => {
        const r = row.original;
        const sql = `ALTER TABLE [${r.fromSchema}].[${r.fromTable}] ADD CONSTRAINT FK_${r.fromTable}_${r.toTable} FOREIGN KEY ([${r.fromColumn}]) REFERENCES [${r.toSchema}].[${r.toTable}]([${r.toColumn}]);`;
        return (
          <button
            onClick={() => navigator.clipboard.writeText(sql)}
            className="text-xs text-accent hover:text-accent-hover transition-colors"
            title={sql}
          >
            Copy SQL
          </button>
        );
      },
    },
  ];
  return <DataTable data={data} columns={columns} searchPlaceholder="Filter implicit relationships..." />;
}

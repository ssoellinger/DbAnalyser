import { useState, useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { DataTable } from '../shared/DataTable';
import { TableDetail } from './TableDetail';
import type { ColumnDef } from '@tanstack/react-table';
import type { DatabaseSchema, TableInfo, ViewInfo } from '../../api/types';

type TabKey = 'tables' | 'views' | 'procedures' | 'functions' | 'triggers' | 'synonyms' | 'sequences' | 'types' | 'jobs';

export function SchemaPage() {
  const schema = useStore((s) => s.result?.schema);
  const [activeTab, setActiveTab] = useState<TabKey>('tables');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  if (!schema) return <p className="text-text-muted">No schema data available.</p>;

  const tabs = ([
    { key: 'tables' as TabKey, label: 'Tables', count: schema.tables.length },
    { key: 'views' as TabKey, label: 'Views', count: schema.views.length },
    { key: 'procedures' as TabKey, label: 'Procedures', count: schema.storedProcedures.length },
    { key: 'functions' as TabKey, label: 'Functions', count: schema.functions.length },
    { key: 'triggers' as TabKey, label: 'Triggers', count: schema.triggers.length },
    { key: 'synonyms' as TabKey, label: 'Synonyms', count: schema.synonyms.length },
    { key: 'sequences' as TabKey, label: 'Sequences', count: schema.sequences.length },
    { key: 'types' as TabKey, label: 'UDTs', count: schema.userDefinedTypes.length },
    { key: 'jobs' as TabKey, label: 'Jobs', count: schema.jobs.length },
  ]).filter((t) => t.count > 0);

  const detail = selectedTable
    ? schema.tables.find((t) => t.fullName === selectedTable)
    : null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">Schema</h2>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSelectedTable(null); }}
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

      {selectedTable && detail ? (
        <div>
          <button
            onClick={() => setSelectedTable(null)}
            className="text-xs text-accent hover:text-accent-hover mb-3 transition-colors"
          >
            ← Back to tables
          </button>
          <TableDetail table={detail} />
        </div>
      ) : (
        <SchemaTabContent
          tab={activeTab}
          schema={schema}
          onSelectTable={setSelectedTable}
        />
      )}
    </div>
  );
}

function SchemaTabContent({
  tab,
  schema,
  onSelectTable,
}: {
  tab: TabKey;
  schema: DatabaseSchema;
  onSelectTable: (name: string) => void;
}) {

  switch (tab) {
    case 'tables': {
      const columns: ColumnDef<TableInfo, any>[] = [
        {
          header: 'Table',
          accessorKey: 'fullName',
          cell: ({ row }) => (
            <button
              onClick={() => onSelectTable(row.original.fullName)}
              className="text-accent hover:text-accent-hover transition-colors"
            >
              {row.original.fullName}
            </button>
          ),
        },
        { header: 'Columns', accessorFn: (r) => r.columns.length },
        { header: 'Indexes', accessorFn: (r) => r.indexes.length },
        { header: 'FKs', accessorFn: (r) => r.foreignKeys.length },
        {
          header: 'PK',
          accessorFn: (r) => r.columns.filter((c) => c.isPrimaryKey).map((c) => c.name).join(', '),
        },
      ];
      return <DataTable data={schema.tables} columns={columns} searchPlaceholder="Filter tables..." />;
    }

    case 'views': {
      const columns: ColumnDef<ViewInfo, any>[] = [
        { header: 'View', accessorKey: 'fullName' },
        { header: 'Columns', accessorFn: (r) => r.columns.length },
      ];
      return <DataTable data={schema.views} columns={columns} searchPlaceholder="Filter views..." />;
    }

    case 'procedures': {
      const columns: ColumnDef<any, any>[] = [
        { header: 'Procedure', accessorKey: 'fullName' },
        { header: 'Last Modified', accessorKey: 'lastModified', cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return v ? new Date(v).toLocaleDateString() : '—';
        }},
      ];
      return <DataTable data={schema.storedProcedures} columns={columns} searchPlaceholder="Filter procedures..." />;
    }

    case 'functions': {
      const columns: ColumnDef<any, any>[] = [
        { header: 'Function', accessorKey: 'fullName' },
        { header: 'Type', accessorKey: 'functionType' },
        { header: 'Last Modified', accessorKey: 'lastModified', cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return v ? new Date(v).toLocaleDateString() : '—';
        }},
      ];
      return <DataTable data={schema.functions} columns={columns} searchPlaceholder="Filter functions..." />;
    }

    case 'triggers': {
      const columns: ColumnDef<any, any>[] = [
        { header: 'Trigger', accessorKey: 'fullName' },
        { header: 'Parent Table', accessorKey: 'parentFullName' },
        { header: 'Type', accessorKey: 'triggerType' },
        { header: 'Events', accessorKey: 'triggerEvents' },
        { header: 'Enabled', accessorKey: 'isEnabled', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
      ];
      return <DataTable data={schema.triggers} columns={columns} searchPlaceholder="Filter triggers..." />;
    }

    case 'synonyms': {
      const columns: ColumnDef<any, any>[] = [
        { header: 'Synonym', accessorKey: 'fullName' },
        { header: 'Base Object', accessorKey: 'baseObjectName' },
      ];
      return <DataTable data={schema.synonyms} columns={columns} searchPlaceholder="Filter synonyms..." />;
    }

    case 'sequences': {
      const columns: ColumnDef<any, any>[] = [
        { header: 'Sequence', accessorKey: 'fullName' },
        { header: 'Data Type', accessorKey: 'dataType' },
        { header: 'Current', accessorKey: 'currentValue' },
        { header: 'Increment', accessorKey: 'increment' },
        { header: 'Cycling', accessorKey: 'isCycling', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
      ];
      return <DataTable data={schema.sequences} columns={columns} searchPlaceholder="Filter sequences..." />;
    }

    case 'types': {
      const columns: ColumnDef<any, any>[] = [
        { header: 'Type', accessorKey: 'fullName' },
        { header: 'Base Type', accessorKey: 'baseType' },
        { header: 'Table Type', accessorKey: 'isTableType', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
        { header: 'Nullable', accessorKey: 'isNullable', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
      ];
      return <DataTable data={schema.userDefinedTypes} columns={columns} />;
    }

    case 'jobs': {
      const columns: ColumnDef<any, any>[] = [
        { header: 'Job', accessorKey: 'jobName' },
        { header: 'Enabled', accessorKey: 'isEnabled', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
        { header: 'Steps', accessorFn: (r) => r.steps?.length ?? 0 },
        { header: 'Last Run', accessorKey: 'lastRunDate', cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return v ? new Date(v).toLocaleDateString() : '—';
        }},
        { header: 'Schedule', accessorKey: 'scheduleDescription', cell: ({ getValue }) => getValue() ?? '—' },
      ];
      return <DataTable data={schema.jobs} columns={columns} searchPlaceholder="Filter jobs..." />;
    }

    default:
      return null;
  }
}

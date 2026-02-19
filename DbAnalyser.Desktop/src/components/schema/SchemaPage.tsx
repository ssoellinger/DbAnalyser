import { useState, useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { DataTable } from '../shared/DataTable';
import { TableDetail } from './TableDetail';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import type { DatabaseSchema, TableInfo, ViewInfo, ColumnInfo, StoredProcedureInfo, FunctionInfo, TriggerInfo } from '../../api/types';

type TabKey = 'tables' | 'views' | 'procedures' | 'functions' | 'triggers' | 'synonyms' | 'sequences' | 'types' | 'jobs';

/* ── Inline SQL code block with Copy button ────────────────────────────── */

function SqlDefinition({ definition }: { definition: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="relative group/code mt-2 rounded border border-border bg-bg-secondary">
      <button
        onClick={() => {
          navigator.clipboard.writeText(definition);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] bg-bg-card border border-border text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors opacity-0 group-hover/code:opacity-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre className="px-4 py-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed max-h-[50vh] overflow-y-auto select-text">
        {definition}
      </pre>
    </div>
  );
}

/* ── View Detail (similar to TableDetail) ──────────────────────────────── */

function ViewDetail({ view }: { view: ViewInfo }) {
  const columnCols: ColumnDef<ColumnInfo, any>[] = [
    { header: '#', accessorKey: 'ordinalPosition', size: 40 },
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          {row.original.name}
          {row.original.isPrimaryKey && (
            <span className="text-[10px] px-1 rounded bg-accent/20 text-accent">PK</span>
          )}
        </span>
      ),
    },
    {
      header: 'Type',
      accessorFn: (r) => {
        let t = r.dataType;
        if (r.maxLength !== null && r.maxLength > 0 && !['int', 'bigint', 'bit', 'datetime', 'date', 'float', 'real', 'uniqueidentifier'].includes(r.dataType))
          t += `(${r.maxLength === -1 ? 'max' : r.maxLength})`;
        if (r.precision !== null && r.scale !== null && ['decimal', 'numeric'].includes(r.dataType))
          t += `(${r.precision},${r.scale})`;
        return t;
      },
    },
    { header: 'Nullable', accessorKey: 'isNullable', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
    { header: 'Computed', accessorKey: 'isComputed', cell: ({ getValue }) => getValue() ? 'Yes' : '' },
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-text-primary">{view.fullName}</h3>

      {view.columns.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">
            Columns ({view.columns.length})
          </h4>
          <DataTable data={view.columns} columns={columnCols} searchable={false} pageSize={100} />
        </div>
      )}

      {view.definition && (
        <div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">SQL Definition</h4>
          <SqlDefinition definition={view.definition} />
        </div>
      )}
    </div>
  );
}

/* ── Main SchemaPage ───────────────────────────────────────────────────── */

export function SchemaPage() {
  const schema = useStore((s) => s.result?.schema);
  const profiles = useStore((s) => s.result?.profiles);
  const relationships = useStore((s) => s.result?.relationships);
  const [activeTab, setActiveTab] = useState<TabKey>('tables');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [expandedDef, setExpandedDef] = useState<string | null>(null);

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

  const tableDetail = selectedTable
    ? schema.tables.find((t) => t.fullName === selectedTable)
    : null;

  const viewDetail = selectedView
    ? schema.views.find((v) => v.fullName === selectedView)
    : null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">Schema</h2>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              setSelectedTable(null);
              setSelectedView(null);
              setExpandedDef(null);
            }}
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

      {selectedTable && tableDetail ? (
        <div>
          <button
            onClick={() => setSelectedTable(null)}
            className="text-xs text-accent hover:text-accent-hover mb-3 transition-colors"
          >
            &larr; Back to tables
          </button>
          <TableDetail table={tableDetail} />
        </div>
      ) : selectedView && viewDetail ? (
        <div>
          <button
            onClick={() => setSelectedView(null)}
            className="text-xs text-accent hover:text-accent-hover mb-3 transition-colors"
          >
            &larr; Back to views
          </button>
          <ViewDetail view={viewDetail} />
        </div>
      ) : (
        <SchemaTabContent
          tab={activeTab}
          schema={schema}
          profiles={profiles ?? null}
          relationships={relationships ?? null}
          expandedDef={expandedDef}
          onSelectTable={setSelectedTable}
          onSelectView={setSelectedView}
          onToggleDef={(name) => setExpandedDef(expandedDef === name ? null : name)}
        />
      )}
    </div>
  );
}

/* ── Tab content ───────────────────────────────────────────────────────── */

function SchemaTabContent({
  tab,
  schema,
  profiles,
  relationships,
  expandedDef,
  onSelectTable,
  onSelectView,
  onToggleDef,
}: {
  tab: TabKey;
  schema: DatabaseSchema;
  profiles: import('../../api/types').TableProfile[] | null;
  relationships: import('../../api/types').RelationshipMap | null;
  expandedDef: string | null;
  onSelectTable: (name: string) => void;
  onSelectView: (name: string) => void;
  onToggleDef: (name: string) => void;
}) {
  // Build lookup maps once
  const rowCountMap = useMemo(() => {
    if (!profiles) return new Map<string, number>();
    return new Map(profiles.map((p) => [p.fullName, p.rowCount]));
  }, [profiles]);

  const viewRefCountMap = useMemo(() => {
    if (!relationships?.viewDependencies) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const dep of relationships.viewDependencies) {
      if (dep.fromType === 'View') {
        const key = `${dep.fromSchema}.${dep.fromName}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [relationships]);

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
        {
          header: 'Rows',
          accessorFn: (r) => rowCountMap.get(r.fullName) ?? null,
          cell: ({ getValue }) => {
            const v = getValue() as number | null;
            return v != null ? v.toLocaleString() : <span className="text-text-muted">—</span>;
          },
        },
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
        {
          header: 'View',
          accessorKey: 'fullName',
          cell: ({ row }) => (
            <button
              onClick={() => onSelectView(row.original.fullName)}
              className="text-accent hover:text-accent-hover transition-colors"
            >
              {row.original.fullName}
            </button>
          ),
        },
        { header: 'Columns', accessorFn: (r) => r.columns.length },
        {
          header: 'Ref. Tables',
          accessorFn: (r) => viewRefCountMap.get(r.fullName) ?? 0,
          cell: ({ getValue }) => {
            const v = getValue() as number;
            return v > 0 ? v : <span className="text-text-muted">0</span>;
          },
        },
      ];
      return <DataTable data={schema.views} columns={columns} searchPlaceholder="Filter views..." />;
    }

    case 'procedures': {
      const columns: ColumnDef<StoredProcedureInfo, any>[] = [
        {
          header: 'Procedure',
          accessorKey: 'fullName',
          cell: ({ row }) => (
            <button
              onClick={() => onToggleDef(row.original.fullName)}
              className="text-accent hover:text-accent-hover transition-colors flex items-center gap-1.5"
            >
              <span className={`text-[10px] transition-transform inline-block ${expandedDef === row.original.fullName ? 'rotate-90' : ''}`}>&#9654;</span>
              {row.original.fullName}
            </button>
          ),
        },
        {
          header: 'Lines',
          accessorFn: (r) => r.definition ? r.definition.split('\n').length : null,
          cell: ({ getValue }) => {
            const v = getValue() as number | null;
            return v != null ? v : <span className="text-text-muted">—</span>;
          },
        },
        {
          header: 'Last Modified',
          accessorKey: 'lastModified',
          cell: ({ getValue }) => {
            const v = getValue() as string | null;
            return v ? new Date(v).toLocaleDateString() : '—';
          },
        },
      ];
      return (
        <ExpandableDataTable
          data={schema.storedProcedures}
          columns={columns}
          expandedDef={expandedDef}
          getKey={(r) => r.fullName}
          getDef={(r) => r.definition}
          searchPlaceholder="Filter procedures..."
        />
      );
    }

    case 'functions': {
      const columns: ColumnDef<FunctionInfo, any>[] = [
        {
          header: 'Function',
          accessorKey: 'fullName',
          cell: ({ row }) => (
            <button
              onClick={() => onToggleDef(row.original.fullName)}
              className="text-accent hover:text-accent-hover transition-colors flex items-center gap-1.5"
            >
              <span className={`text-[10px] transition-transform inline-block ${expandedDef === row.original.fullName ? 'rotate-90' : ''}`}>&#9654;</span>
              {row.original.fullName}
            </button>
          ),
        },
        { header: 'Type', accessorKey: 'functionType' },
        {
          header: 'Lines',
          accessorFn: (r) => r.definition ? r.definition.split('\n').length : null,
          cell: ({ getValue }) => {
            const v = getValue() as number | null;
            return v != null ? v : <span className="text-text-muted">—</span>;
          },
        },
        {
          header: 'Last Modified',
          accessorKey: 'lastModified',
          cell: ({ getValue }) => {
            const v = getValue() as string | null;
            return v ? new Date(v).toLocaleDateString() : '—';
          },
        },
      ];
      return (
        <ExpandableDataTable
          data={schema.functions}
          columns={columns}
          expandedDef={expandedDef}
          getKey={(r) => r.fullName}
          getDef={(r) => r.definition}
          searchPlaceholder="Filter functions..."
        />
      );
    }

    case 'triggers': {
      const columns: ColumnDef<TriggerInfo, any>[] = [
        {
          header: 'Trigger',
          accessorKey: 'fullName',
          cell: ({ row }) => (
            <button
              onClick={() => onToggleDef(row.original.fullName)}
              className="text-accent hover:text-accent-hover transition-colors flex items-center gap-1.5"
            >
              <span className={`text-[10px] transition-transform inline-block ${expandedDef === row.original.fullName ? 'rotate-90' : ''}`}>&#9654;</span>
              {row.original.fullName}
            </button>
          ),
        },
        { header: 'Parent Table', accessorKey: 'parentFullName' },
        { header: 'Type', accessorKey: 'triggerType' },
        { header: 'Events', accessorKey: 'triggerEvents' },
        { header: 'Enabled', accessorKey: 'isEnabled', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
      ];
      return (
        <ExpandableDataTable
          data={schema.triggers}
          columns={columns}
          expandedDef={expandedDef}
          getKey={(r) => r.fullName}
          getDef={(r) => r.definition}
          searchPlaceholder="Filter triggers..."
        />
      );
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

/* ── DataTable wrapper with expandable SQL definition rows ─────────────── */

function ExpandableDataTable<T>({
  data,
  columns,
  expandedDef,
  getKey,
  getDef,
  searchPlaceholder,
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  expandedDef: string | null;
  getKey: (row: T) => string;
  getDef: (row: T) => string | undefined;
  searchPlaceholder?: string;
}) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  return (
    <div className="space-y-3">
      <input
        value={globalFilter}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGlobalFilter(e.target.value)}
        placeholder={searchPlaceholder}
        className="w-full max-w-xs bg-bg-primary border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg: any) => (
              <tr key={hg.id} className="border-b border-border bg-bg-secondary">
                {hg.headers.map((header: any) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className="px-3 py-2 text-left text-xs font-medium text-text-secondary cursor-pointer hover:text-text-primary select-none"
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: ' \u25B2', desc: ' \u25BC' }[header.column.getIsSorted() as string] ?? ''}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row: any) => {
              const key = getKey(row.original);
              const def = getDef(row.original);
              const isExpanded = expandedDef === key;

              return (
                <ExpandableRow key={row.id} row={row} isExpanded={isExpanded} definition={def} />
              );
            })}
          </tbody>
        </table>
      </div>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>
            {table.getFilteredRowModel().rows.length} row{table.getFilteredRowModel().rows.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-2 py-1 rounded border border-border hover:bg-bg-hover disabled:opacity-30 transition-colors"
            >
              Prev
            </button>
            <span>
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-2 py-1 rounded border border-border hover:bg-bg-hover disabled:opacity-30 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExpandableRow({ row, isExpanded, definition }: {
  row: any;
  isExpanded: boolean;
  definition: string | undefined;
}) {
  const colSpan = row.getVisibleCells().length;

  return (
    <>
      <tr className={`border-b border-border/50 hover:bg-bg-hover transition-colors ${isExpanded ? 'bg-bg-hover' : ''}`}>
        {row.getVisibleCells().map((cell: any) => (
          <td key={cell.id} className="px-3 py-2 text-text-primary">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>
      {isExpanded && definition && (
        <tr>
          <td colSpan={colSpan} className="px-3 py-2">
            <SqlDefinition definition={definition} />
          </td>
        </tr>
      )}
    </>
  );
}

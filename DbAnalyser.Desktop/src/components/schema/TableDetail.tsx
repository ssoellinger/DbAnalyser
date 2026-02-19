import { useState, useMemo } from 'react';
import { DataTable } from '../shared/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import type { TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo } from '../../api/types';

function formatColumnType(r: ColumnInfo): string {
  let t = r.dataType;
  if (r.maxLength !== null && r.maxLength > 0 && !['int', 'bigint', 'bit', 'datetime', 'date', 'float', 'real', 'uniqueidentifier'].includes(r.dataType))
    t += `(${r.maxLength === -1 ? 'max' : r.maxLength})`;
  if (r.precision !== null && r.scale !== null && ['decimal', 'numeric'].includes(r.dataType))
    t += `(${r.precision},${r.scale})`;
  return t;
}

function generateDdl(table: TableInfo): string {
  const lines: string[] = [];
  lines.push(`CREATE TABLE [${table.schemaName}].[${table.tableName}] (`);

  const colLines: string[] = table.columns.map((c) => {
    let line = `    [${c.name}] ${formatColumnType(c).toUpperCase()}`;
    if (c.isIdentity) line += ' IDENTITY';
    if (c.isComputed) line += ' /* computed */';
    else line += c.isNullable ? ' NULL' : ' NOT NULL';
    if (c.defaultValue) line += ` DEFAULT ${c.defaultValue}`;
    return line;
  });

  const pkCols = table.columns.filter((c) => c.isPrimaryKey);
  if (pkCols.length > 0) {
    colLines.push(`    CONSTRAINT [PK_${table.tableName}] PRIMARY KEY (${pkCols.map((c) => `[${c.name}]`).join(', ')})`);
  }

  lines.push(colLines.join(',\n'));
  lines.push(');');

  if (table.foreignKeys.length > 0) {
    lines.push('');
    for (const fk of table.foreignKeys) {
      lines.push(`ALTER TABLE [${table.schemaName}].[${table.tableName}]`);
      lines.push(`    ADD CONSTRAINT [${fk.name}] FOREIGN KEY ([${fk.fromColumn}])`);
      lines.push(`    REFERENCES [${fk.toSchema}].[${fk.toTable}] ([${fk.toColumn}]);`);
    }
  }

  return lines.join('\n');
}

export function TableDetail({ table }: { table: TableInfo }) {
  const [showDdl, setShowDdl] = useState(false);
  const [copied, setCopied] = useState(false);
  const ddl = useMemo(() => generateDdl(table), [table]);
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
          {row.original.isIdentity && (
            <span className="text-[10px] px-1 rounded bg-node-function/20 text-node-function">ID</span>
          )}
        </span>
      ),
    },
    { header: 'Type', accessorFn: (r) => formatColumnType(r) },
    { header: 'Nullable', accessorKey: 'isNullable', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
    { header: 'Computed', accessorKey: 'isComputed', cell: ({ getValue }) => getValue() ? 'Yes' : '' },
    { header: 'Default', accessorKey: 'defaultValue', cell: ({ getValue }) => getValue() ?? '' },
  ];

  const indexCols: ColumnDef<IndexInfo, any>[] = [
    { header: 'Index', accessorKey: 'name' },
    { header: 'Type', accessorKey: 'type' },
    { header: 'Unique', accessorKey: 'isUnique', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
    { header: 'Clustered', accessorKey: 'isClustered', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
    { header: 'Columns', accessorFn: (r) => r.columns.join(', ') },
  ];

  const fkCols: ColumnDef<ForeignKeyInfo, any>[] = [
    { header: 'Name', accessorKey: 'name' },
    { header: 'Column', accessorKey: 'fromColumn' },
    { header: 'References', accessorFn: (r) => `${r.toSchema}.${r.toTable}.${r.toColumn}` },
    { header: 'Delete', accessorKey: 'deleteRule' },
    { header: 'Update', accessorKey: 'updateRule' },
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-text-primary">{table.fullName}</h3>

      <div>
        <h4 className="text-sm font-medium text-text-secondary mb-2">
          Columns ({table.columns.length})
        </h4>
        <DataTable data={table.columns} columns={columnCols} searchable={false} pageSize={100} />
      </div>

      {table.indexes.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">
            Indexes ({table.indexes.length})
          </h4>
          <DataTable data={table.indexes} columns={indexCols} searchable={false} pageSize={50} />
        </div>
      )}

      {table.foreignKeys.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">
            Foreign Keys ({table.foreignKeys.length})
          </h4>
          <DataTable data={table.foreignKeys} columns={fkCols} searchable={false} pageSize={50} />
        </div>
      )}

      <div>
        <button
          onClick={() => setShowDdl(!showDdl)}
          className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1.5"
        >
          <span className={`text-[10px] transition-transform inline-block ${showDdl ? 'rotate-90' : ''}`}>&#9654;</span>
          SQL Definition
        </button>
        {showDdl && (
          <div className="relative group/code mt-2 rounded border border-border bg-bg-secondary">
            <button
              onClick={() => {
                navigator.clipboard.writeText(ddl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] bg-bg-card border border-border text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors opacity-0 group-hover/code:opacity-100"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <pre className="px-4 py-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed max-h-[50vh] overflow-y-auto select-text">
              {ddl}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

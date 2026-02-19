import { DataTable } from '../shared/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import type { TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo } from '../../api/types';

export function TableDetail({ table }: { table: TableInfo }) {
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
    </div>
  );
}

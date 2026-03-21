import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../shared/DataTable';
import type { QueryResultSet } from '../../api/types';

interface QueryResultsGridProps {
  resultSet: QueryResultSet;
}

type RowData = Record<string, unknown>;

export function QueryResultsGrid({ resultSet }: QueryResultsGridProps) {
  const { columns: colNames, rows } = resultSet;

  const columns = useMemo<ColumnDef<RowData, unknown>[]>(
    () => [
      // Row number column
      {
        id: '_rowNum',
        header: '#',
        cell: ({ row }) => (
          <span className="text-text-muted text-xs">{row.index + 1}</span>
        ),
        size: 50,
        enableSorting: false,
      },
      ...colNames.map((col) => ({
        accessorKey: col,
        header: col,
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const val = getValue();
          if (val === null || val === undefined) {
            return <span className="italic text-text-muted">NULL</span>;
          }
          return String(val);
        },
      })),
    ],
    [colNames],
  );

  const data = useMemo<RowData[]>(
    () =>
      rows.map((row) => {
        const obj: RowData = {};
        colNames.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      }),
    [rows, colNames],
  );

  return (
    <DataTable
      data={data}
      columns={columns}
      pageSize={50}
      searchable={data.length > 10}
      searchPlaceholder="Filter results..."
    />
  );
}

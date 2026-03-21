import { useMemo, useCallback, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../shared/DataTable';
import type { QueryResultSet } from '../../api/types';

interface QueryResultsGridProps {
  resultSet: QueryResultSet;
}

type RowData = Record<string, unknown>;

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  return String(val);
}

function resultSetToCsv(resultSet: QueryResultSet): string {
  const escape = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const header = resultSet.columns.map(escape).join(',');
  const rows = resultSet.rows.map((row) =>
    row.map((v) => escape(cellToString(v))).join(','),
  );
  return [header, ...rows].join('\n');
}

export function QueryResultsGrid({ resultSet }: QueryResultsGridProps) {
  const { columns: colNames, rows } = resultSet;
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const handleCellClick = useCallback((text: string, cellId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCell(cellId);
    setTimeout(() => setCopiedCell(null), 800);
  }, []);

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
        cell: ({ getValue, row }: { getValue: () => unknown; row: { index: number } }) => {
          const val = getValue();
          const text = cellToString(val);
          const cellId = `${row.index}-${col}`;
          const isCopied = copiedCell === cellId;
          return (
            <span
              onClick={() => handleCellClick(text, cellId)}
              className={`cursor-pointer rounded px-0.5 -mx-0.5 transition-colors hover:bg-white/5 ${isCopied ? 'bg-green-500/20 text-green-400' : ''}`}
              title="Click to copy"
            >
              {val === null || val === undefined
                ? <span className="italic text-text-muted">NULL</span>
                : String(val)}
            </span>
          );
        },
      })),
    ],
    [colNames, copiedCell, handleCellClick],
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

  const [copyFeedback, setCopyFeedback] = useState('');

  const showFeedback = useCallback((msg: string) => {
    setCopyFeedback(msg);
    setTimeout(() => setCopyFeedback(''), 1500);
  }, []);

  const copyAllResults = useCallback(() => {
    const csv = resultSetToCsv(resultSet);
    navigator.clipboard.writeText(csv);
    showFeedback('Copied all rows');
  }, [resultSet, showFeedback]);

  const exportCsv = useCallback(() => {
    const csv = resultSetToCsv(resultSet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query-results-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [resultSet]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={copyAllResults}
          className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="Copy all results as CSV to clipboard"
        >
          Copy All
        </button>
        <button
          onClick={exportCsv}
          className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="Download as CSV file"
        >
          Export CSV
        </button>
        {copyFeedback && (
          <span className="text-xs text-green-400">{copyFeedback}</span>
        )}
      </div>
      <DataTable
        data={data}
        columns={columns}
        pageSize={50}
        searchable={data.length > 10}
        searchPlaceholder="Filter results..."
        enableColumnResizing
      />
    </div>
  );
}

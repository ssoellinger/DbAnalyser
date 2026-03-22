import { useMemo, useCallback, useState, type ReactNode } from 'react';
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

/** Highlight matching text segments */
function highlightText(text: string, filter: string): ReactNode {
  if (!filter) return text;
  const idx = text.toLowerCase().indexOf(filter.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent/30 text-text-primary rounded-sm px-0.5">{text.slice(idx, idx + filter.length)}</mark>
      {text.slice(idx + filter.length)}
    </>
  );
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

function resultSetToJson(resultSet: QueryResultSet): string {
  const objects = resultSet.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    resultSet.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

function resultSetToInsert(resultSet: QueryResultSet, tableName = 'TableName'): string {
  if (resultSet.rows.length === 0) return `-- No rows to insert into [${tableName}]`;

  const escapeSqlValue = (val: string | number | boolean | null): string => {
    if (val === null) return 'NULL';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return val ? '1' : '0';
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const cols = resultSet.columns.map((c) => `[${c}]`).join(', ');
  const lines = resultSet.rows.map((row) => {
    const values = row.map(escapeSqlValue).join(', ');
    return `INSERT INTO [${tableName}] (${cols}) VALUES (${values});`;
  });
  return lines.join('\n');
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/:/g, '-');
}

export function QueryResultsGrid({ resultSet }: QueryResultsGridProps) {
  const { columns: colNames, rows } = resultSet;
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [filterTerm, setFilterTerm] = useState('');

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
                : highlightText(String(val), filterTerm)}
            </span>
          );
        },
      })),
    ],
    [colNames, copiedCell, handleCellClick, filterTerm],
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
    downloadFile(resultSetToCsv(resultSet), `query-results-${timestamp()}.csv`, 'text/csv');
  }, [resultSet]);

  const exportJson = useCallback(() => {
    downloadFile(resultSetToJson(resultSet), `query-results-${timestamp()}.json`, 'application/json');
    setShowExportMenu(false);
  }, [resultSet]);

  const exportInsert = useCallback(() => {
    downloadFile(resultSetToInsert(resultSet), `query-results-${timestamp()}.sql`, 'text/sql');
    setShowExportMenu(false);
  }, [resultSet]);

  const copyAsJson = useCallback(() => {
    navigator.clipboard.writeText(resultSetToJson(resultSet));
    showFeedback('Copied as JSON');
    setShowExportMenu(false);
  }, [resultSet, showFeedback]);

  const copyAsInsert = useCallback(() => {
    navigator.clipboard.writeText(resultSetToInsert(resultSet));
    showFeedback('Copied as INSERT');
    setShowExportMenu(false);
  }, [resultSet, showFeedback]);

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

        {/* Export dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="More export options"
          >
            Export &#9662;
          </button>
          {showExportMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
              <div className="absolute top-full left-0 mt-1 w-44 bg-bg-secondary border border-border rounded shadow-lg z-50">
                <button onClick={exportJson}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors text-text-primary">
                  Export JSON
                </button>
                <button onClick={exportInsert}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors text-text-primary">
                  Export SQL INSERT
                </button>
                <div className="border-t border-border" />
                <button onClick={copyAsJson}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors text-text-primary">
                  Copy as JSON
                </button>
                <button onClick={copyAsInsert}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors text-text-primary">
                  Copy as INSERT
                </button>
              </div>
            </>
          )}
        </div>

        {copyFeedback && (
          <span className="text-xs text-green-400">{copyFeedback}</span>
        )}

        {/* Row count */}
        <span className="ml-auto text-xs text-text-muted">
          {resultSet.totalRowsReturned.toLocaleString()} row{resultSet.totalRowsReturned !== 1 ? 's' : ''}
          {resultSet.truncated && <span className="text-amber-400 ml-1">(truncated)</span>}
        </span>
      </div>
      <DataTable
        data={data}
        columns={columns}
        pageSize={200}
        searchable={data.length > 10}
        searchPlaceholder="Filter results..."
        enableColumnResizing
        onFilterChange={setFilterTerm}
      />
    </div>
  );
}

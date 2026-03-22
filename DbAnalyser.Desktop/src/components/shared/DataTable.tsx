import { useState, useMemo, useCallback } from 'react';
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

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  pageSize?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  enableColumnResizing?: boolean;
  onFilterChange?: (filter: string) => void;
}

export function DataTable<T>({
  data,
  columns,
  pageSize = 25,
  searchable = true,
  searchPlaceholder = 'Filter...',
  enableColumnResizing = false,
  onFilterChange,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const handleFilterChange = useCallback((value: string) => {
    setGlobalFilter(value);
    onFilterChange?.(value);
  }, [onFilterChange]);

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
    initialState: { pagination: { pageSize } },
    ...(enableColumnResizing ? { columnResizeMode: 'onChange' as const, enableColumnResizing: true } : {}),
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = data.length;
  const isFiltering = globalFilter.length > 0;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const rowStart = pageIndex * pageSize + 1;
  const rowEnd = Math.min((pageIndex + 1) * pageSize, filteredCount);

  return (
    <div className="space-y-3">
      {searchable && (
        <div className="flex items-center gap-2">
          <input
            value={globalFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full max-w-xs bg-bg-primary border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          {isFiltering && (
            <>
              <span className="text-xs text-text-secondary">
                {filteredCount === 0
                  ? 'No matches'
                  : `${filteredCount} of ${totalCount} rows`}
              </span>
              <button
                onClick={() => handleFilterChange('')}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
                title="Clear filter"
              >
                &#10005;
              </button>
            </>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm" style={enableColumnResizing ? { tableLayout: 'fixed', width: table.getCenterTotalSize() } : undefined}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-bg-secondary">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={`px-3 py-2 text-left text-xs font-medium text-text-secondary cursor-pointer hover:text-text-primary select-none${enableColumnResizing ? ' relative' : ''}`}
                    style={enableColumnResizing ? { width: header.getSize() } : undefined}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: ' \u25B2', desc: ' \u25BC' }[header.column.getIsSorted() as string] ?? ''}
                    </div>
                    {enableColumnResizing && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(e) => e.stopPropagation()}
                        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none transition-colors ${header.column.getIsResizing() ? 'bg-accent' : 'hover:bg-accent/50'}`}
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-3 py-2 text-text-primary overflow-hidden text-ellipsis"
                    style={enableColumnResizing ? { width: cell.column.getSize() } : undefined}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(totalCount > 50 || isFiltering) && (
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>
            {isFiltering
              ? `Showing ${rowStart}-${rowEnd} of ${filteredCount} matches (${totalCount} total)`
              : `${filteredCount} row${filteredCount !== 1 ? 's' : ''}`}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              Rows:
              <select
                value={table.getState().pagination.pageSize}
                onChange={(e) => table.setPageSize(Number(e.target.value))}
                className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary"
              >
                {[50, 100, 200, 1000].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
            {pageCount > 1 && (
              <>
                <button
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  className="px-2 py-1 rounded border border-border hover:bg-bg-hover disabled:opacity-30 transition-colors"
                >
                  Prev
                </button>
                <span>
                  Page {pageIndex + 1} of {pageCount}
                </span>
                <button
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  className="px-2 py-1 rounded border border-border hover:bg-bg-hover disabled:opacity-30 transition-colors"
                >
                  Next
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

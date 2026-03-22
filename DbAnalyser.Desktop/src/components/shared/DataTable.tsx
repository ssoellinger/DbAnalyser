import { useState, useCallback, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  pageSize?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  enableColumnResizing?: boolean;
  onFilterChange?: (filter: string) => void;
}

const ROW_HEIGHT = 33; // px per row — matches py-2 + text-sm + border

export function DataTable<T>({
  data,
  columns,
  pageSize: _pageSize, // ignored now — kept for API compat
  searchable = true,
  searchPlaceholder = 'Filter...',
  enableColumnResizing = false,
  onFilterChange,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
    ...(enableColumnResizing ? { columnResizeMode: 'onChange' as const, enableColumnResizing: true } : {}),
  });

  const { rows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = data.length;
  const isFiltering = globalFilter.length > 0;

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

      <div
        ref={scrollContainerRef}
        className="overflow-auto rounded border border-border"
        style={{ maxHeight: 'calc(100vh - 350px)' }}
      >
        <table className="w-full text-sm" style={enableColumnResizing ? { tableLayout: 'fixed', width: table.getCenterTotalSize() } : undefined}>
          <thead className="sticky top-0 z-10">
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
            {/* Spacer for rows above the visible window */}
            {virtualizer.getVirtualItems().length > 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0, padding: 0, border: 'none' }}
                />
              </tr>
            )}
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
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
              );
            })}
            {/* Spacer for rows below the visible window */}
            {virtualizer.getVirtualItems().length > 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
                    padding: 0,
                    border: 'none',
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(totalCount > 50 || isFiltering) && (
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>
            {isFiltering
              ? `${filteredCount} of ${totalCount} rows`
              : `${totalCount} row${totalCount !== 1 ? 's' : ''}`}
          </span>
        </div>
      )}
    </div>
  );
}

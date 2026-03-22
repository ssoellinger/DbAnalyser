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

const ROW_HEIGHT = 33;

export function DataTable<T>({
  data,
  columns,
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
    overscan: 15,
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = data.length;
  const isFiltering = globalFilter.length > 0;

  // Build column widths for CSS grid
  const headerGroups = table.getHeaderGroups();
  const gridTemplate = enableColumnResizing
    ? table.getAllColumns().map((col) => `${col.getSize()}px`).join(' ')
    : table.getAllColumns().map(() => 'minmax(80px, 1fr)').join(' ');

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {searchable && (
        <div className="flex items-center gap-2 flex-shrink-0">
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

      <div className="rounded border border-border overflow-hidden flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="bg-bg-secondary border-b border-border overflow-x-auto flex-shrink-0">
          {headerGroups.map((hg) => (
            <div
              key={hg.id}
              className="grid"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {hg.headers.map((header) => (
                <div
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  className={`px-3 py-2 text-left text-xs font-medium text-text-secondary cursor-pointer hover:text-text-primary select-none ${enableColumnResizing ? 'relative' : ''}`}
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
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Virtualized body */}
        <div
          ref={scrollContainerRef}
          className="overflow-auto flex-1 min-h-0"
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              willChange: 'transform',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <div
                  key={row.id}
                  className="grid border-b border-border/50 hover:bg-bg-hover transition-colors"
                  style={{
                    gridTemplateColumns: gridTemplate,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div
                      key={cell.id}
                      className="px-3 py-2 text-sm text-text-primary overflow-hidden text-ellipsis whitespace-nowrap"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {(rows.length > 50 || isFiltering) && (() => {
        const rowsPerPage = 200;
        const pageCount = Math.ceil(rows.length / rowsPerPage);
        const currentRow = virtualizer.getVirtualItems()[0]?.index ?? 0;
        const currentPage = Math.floor(currentRow / rowsPerPage);

        const jumpToPage = (page: number) => {
          virtualizer.scrollToIndex(page * rowsPerPage, { align: 'start' });
        };

        return (
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>
              {isFiltering
                ? `${filteredCount} of ${totalCount} rows`
                : `${rows.length} row${rows.length !== 1 ? 's' : ''}`}
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => jumpToPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0}
                  className="px-2 py-0.5 rounded border border-border hover:bg-bg-hover disabled:opacity-30 transition-colors"
                >
                  Prev
                </button>
                {Array.from({ length: pageCount }, (_, i) => {
                  // Show first, last, and pages around current
                  if (i === 0 || i === pageCount - 1 || Math.abs(i - currentPage) <= 1) {
                    return (
                      <button
                        key={i}
                        onClick={() => jumpToPage(i)}
                        className={`px-2 py-0.5 rounded border transition-colors ${i === currentPage ? 'border-accent text-accent bg-accent/10' : 'border-border hover:bg-bg-hover'}`}
                      >
                        {i + 1}
                      </button>
                    );
                  }
                  // Show ellipsis between gaps
                  if (i === 1 && currentPage > 2) return <span key={i} className="px-1">&hellip;</span>;
                  if (i === pageCount - 2 && currentPage < pageCount - 3) return <span key={i} className="px-1">&hellip;</span>;
                  return null;
                })}
                <button
                  onClick={() => jumpToPage(Math.min(pageCount - 1, currentPage + 1))}
                  disabled={currentPage >= pageCount - 1}
                  className="px-2 py-0.5 rounded border border-border hover:bg-bg-hover disabled:opacity-30 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

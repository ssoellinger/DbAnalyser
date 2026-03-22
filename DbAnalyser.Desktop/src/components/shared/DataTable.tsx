import { useState, useCallback, useRef, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type Row,
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
const PAGE_SIZE_OPTIONS = [50, 100, 200, 1000];

export function DataTable<T>({
  data,
  columns,
  pageSize: defaultPageSize = 200,
  searchable = true,
  searchPlaceholder = 'Filter...',
  enableColumnResizing = false,
  onFilterChange,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [pageIndex, setPageIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleFilterChange = useCallback((value: string) => {
    setGlobalFilter(value);
    setPageIndex(0);
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

  const allRows = table.getRowModel().rows;

  // Paginate: slice rows for current page
  const pageCount = Math.ceil(allRows.length / pageSize);
  const safePageIndex = Math.min(pageIndex, Math.max(0, pageCount - 1));
  const pageRows = useMemo<Row<T>[]>(
    () => allRows.slice(safePageIndex * pageSize, (safePageIndex + 1) * pageSize),
    [allRows, safePageIndex, pageSize],
  );

  // Virtualize only the current page's rows
  const virtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  const goToPage = useCallback((page: number) => {
    setPageIndex(page);
    // Scroll to top when changing pages
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, []);

  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = data.length;
  const isFiltering = globalFilter.length > 0;

  const headerGroups = table.getHeaderGroups();
  const allColumns = table.getAllColumns();
  const gridTemplate = useMemo(
    () => enableColumnResizing
      ? allColumns.map((col) => `${col.getSize()}px`).join(' ')
      : allColumns.map(() => 'minmax(80px, 1fr)').join(' '),
    [allColumns, enableColumnResizing],
  );

  const rowStart = safePageIndex * pageSize + 1;
  const rowEnd = Math.min((safePageIndex + 1) * pageSize, allRows.length);

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

      <div
        ref={scrollContainerRef}
        className="rounded border border-border overflow-auto flex-1 min-h-0"
      >
        <div style={{ minWidth: enableColumnResizing ? table.getCenterTotalSize() : undefined }}>
          {/* Sticky header */}
          <div className="sticky top-0 z-10 bg-bg-secondary border-b border-border">
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
                    className={`px-3 py-2 text-left text-xs font-medium text-text-secondary cursor-pointer hover:text-text-primary select-none overflow-hidden ${enableColumnResizing ? 'relative' : ''}`}
                    title={typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : undefined}
                  >
                    <div className="flex items-center gap-1 overflow-hidden">
                      <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                      <span className="flex-shrink-0">{{ asc: '\u25B2', desc: '\u25BC' }[header.column.getIsSorted() as string] ?? ''}</span>
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

          {/* Virtualized body (current page only) */}
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              willChange: 'transform',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = pageRows[virtualRow.index];
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

      {/* Footer: pagination + page size */}
      {(allRows.length > 50 || isFiltering) && (
        <div className="flex items-center justify-between text-xs text-text-secondary flex-shrink-0">
          <span>
            {isFiltering
              ? `${filteredCount} of ${totalCount} rows`
              : allRows.length > pageSize
                ? `${rowStart}\u2013${rowEnd} of ${allRows.length} rows`
                : `${allRows.length} row${allRows.length !== 1 ? 's' : ''}`}
          </span>
          <div className="flex items-center gap-2">
            {/* Page size selector */}
            <label className="flex items-center gap-1">
              Rows:
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPageIndex(0); scrollContainerRef.current?.scrollTo({ top: 0 }); }}
                className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>

            {/* Page navigation */}
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(safePageIndex - 1)}
                  disabled={safePageIndex === 0}
                  className="px-2 py-0.5 rounded border border-border hover:bg-bg-hover disabled:opacity-30 transition-colors"
                >
                  Prev
                </button>
                {Array.from({ length: pageCount }, (_, i) => {
                  if (i === 0 || i === pageCount - 1 || Math.abs(i - safePageIndex) <= 1) {
                    return (
                      <button
                        key={i}
                        onClick={() => goToPage(i)}
                        className={`px-2 py-0.5 rounded border transition-colors ${i === safePageIndex ? 'border-accent text-accent bg-accent/10' : 'border-border hover:bg-bg-hover'}`}
                      >
                        {i + 1}
                      </button>
                    );
                  }
                  if (i === 1 && safePageIndex > 2) return <span key={i} className="px-1">&hellip;</span>;
                  if (i === pageCount - 2 && safePageIndex < pageCount - 3) return <span key={i} className="px-1">&hellip;</span>;
                  return null;
                })}
                <button
                  onClick={() => goToPage(safePageIndex + 1)}
                  disabled={safePageIndex >= pageCount - 1}
                  className="px-2 py-0.5 rounded border border-border hover:bg-bg-hover disabled:opacity-30 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../hooks/useStore';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { DataTable } from './DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import type { ColumnInfo, IndexInfo, ForeignKeyInfo, TableInfo, ViewInfo } from '../../api/types';

interface SearchItem {
  name: string;
  type: string;
  definition?: string;
  matchLine?: string;
}

function formatColumnType(r: ColumnInfo): string {
  let t = r.dataType;
  if (r.maxLength !== null && r.maxLength > 0 && !['int', 'bigint', 'bit', 'datetime', 'date', 'float', 'real', 'uniqueidentifier'].includes(r.dataType))
    t += `(${r.maxLength === -1 ? 'max' : r.maxLength})`;
  if (r.precision !== null && r.scale !== null && ['decimal', 'numeric'].includes(r.dataType))
    t += `(${r.precision},${r.scale})`;
  return t;
}

export function SearchDialog() {
  const open = useStore((s) => s.searchOpen);
  const toggleSearch = useStore((s) => s.toggleSearch);
  const result = useStore((s) => s.result);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'name' | 'code'>('name');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  // Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
      }
      if (e.key === 'Escape' && open) {
        if (detail) {
          setDetail(null);
        } else if (expanded) {
          setExpanded(null);
        } else {
          toggleSearch();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, expanded, detail, toggleSearch]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setExpanded(null);
      setDetail(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const allItems = useMemo<SearchItem[]>(() => {
    if (!result) return [];
    const items: SearchItem[] = [];

    result.schema?.tables.forEach((t) =>
      items.push({ name: t.fullName, type: 'Table' })
    );
    result.schema?.views.forEach((v) =>
      items.push({ name: v.fullName, type: 'View', definition: v.definition })
    );
    result.schema?.storedProcedures.forEach((p) =>
      items.push({ name: p.fullName, type: 'Procedure', definition: p.definition })
    );
    result.schema?.functions.forEach((f) =>
      items.push({ name: f.fullName, type: 'Function', definition: f.definition })
    );
    result.schema?.triggers.forEach((t) =>
      items.push({ name: t.fullName, type: 'Trigger', definition: t.definition })
    );
    result.schema?.synonyms.forEach((s) =>
      items.push({ name: s.fullName, type: 'Synonym' })
    );

    return items;
  }, [result]);

  const filtered = useMemo(() => {
    if (!query.trim()) return mode === 'name' ? allItems.slice(0, 20) : [];
    const q = query.toLowerCase();

    if (mode === 'name') {
      return allItems.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 20);
    }

    // Code search: search in definitions
    const results: SearchItem[] = [];
    for (const item of allItems) {
      if (!item.definition) continue;
      const defLower = item.definition.toLowerCase();
      const idx = defLower.indexOf(q);
      if (idx === -1) continue;

      const lines = item.definition.split('\n');
      let matchLine: string | undefined;
      let pos = 0;
      for (const line of lines) {
        if (pos + line.length >= idx) {
          matchLine = line.trim();
          break;
        }
        pos += line.length + 1;
      }

      results.push({ ...item, matchLine });
      if (results.length >= 30) break;
    }
    return results;
  }, [allItems, query, mode]);

  useEffect(() => {
    setSelectedIndex(0);
    setExpanded(null);
  }, [query, mode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      const item = filtered[selectedIndex];
      setDetail(item);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setMode((prev) => (prev === 'name' ? 'code' : 'name'));
    }
  };

  if (!open) return null;

  function highlightMatch(text: string, q: string) {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="bg-accent/30 text-accent rounded px-0.5">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    );
  }

  function highlightCode(code: string, q: string) {
    if (!q) return code;
    const parts: (string | JSX.Element)[] = [];
    const lower = code.toLowerCase();
    const qLower = q.toLowerCase();
    let lastIdx = 0;
    let idx = lower.indexOf(qLower);
    let key = 0;
    while (idx !== -1) {
      if (idx > lastIdx) parts.push(code.slice(lastIdx, idx));
      parts.push(
        <span key={key++} className="bg-accent/30 text-accent rounded px-0.5">
          {code.slice(idx, idx + q.length)}
        </span>
      );
      lastIdx = idx + q.length;
      idx = lower.indexOf(qLower, lastIdx);
    }
    if (lastIdx < code.length) parts.push(code.slice(lastIdx));
    return <>{parts}</>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/60" onClick={() => { if (!detail && !expanded) toggleSearch(); }}>
      <div
        className={`w-full bg-bg-card border border-border rounded-lg shadow-2xl overflow-hidden transition-all ${
          detail ? 'max-w-4xl' : expanded ? 'max-w-4xl' : 'max-w-lg'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Detail view */}
        {detail ? (
          <DetailPanel
            item={detail}
            result={result}
            onBack={() => setDetail(null)}
          />
        ) : (
          <>
            <div className="flex items-center border-b border-border">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === 'name' ? 'Search object names...' : 'Search in SQL code...'}
                className="flex-1 px-4 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              <div className="flex items-center gap-1 pr-3">
                <button
                  onClick={() => setMode('name')}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    mode === 'name' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  Name
                </button>
                <button
                  onClick={() => setMode('code')}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    mode === 'code' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  Code
                </button>
                <span className="text-[9px] text-text-muted ml-1">Tab</span>
              </div>
            </div>

            <div className={`overflow-y-auto ${expanded ? 'max-h-[70vh]' : 'max-h-96'}`}>
              {filtered.map((item, i) => {
                const isExpanded = expanded === item.name;
                const hasDef = !!item.definition;

                return (
                  <div key={`${item.name}-${i}`}>
                    <button
                      onClick={() => setDetail(item)}
                      onDoubleClick={() => {
                        if (hasDef) {
                          setExpanded(isExpanded ? null : item.name);
                        }
                      }}
                      className={`w-full flex flex-col gap-0.5 px-4 py-2.5 text-left transition-colors ${
                        i === selectedIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: OBJECT_TYPE_COLORS[item.type] ?? '#666' }}
                        />
                        <span className="text-sm text-text-primary truncate">
                          {mode === 'name' ? highlightMatch(item.name, query) : item.name}
                        </span>
                        <span className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-text-muted">{item.type}</span>
                        </span>
                      </div>
                      {mode === 'code' && item.matchLine && !isExpanded && (
                        <div className="ml-5 text-[11px] text-text-muted font-mono truncate">
                          {highlightMatch(item.matchLine, query)}
                        </div>
                      )}
                    </button>

                    {isExpanded && item.definition && (
                      <div className="border-t border-border/50 bg-bg-secondary relative group/code">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(item.definition!);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] bg-bg-card border border-border text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors opacity-0 group-hover/code:opacity-100"
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                        <pre className="px-4 py-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed max-h-[50vh] overflow-y-auto select-text">
                          {mode === 'code' && query.trim()
                            ? highlightCode(item.definition, query)
                            : item.definition}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && query.trim() && (
                <p className="px-4 py-6 text-sm text-text-muted text-center">No results found</p>
              )}
              {mode === 'code' && !query.trim() && (
                <p className="px-4 py-6 text-sm text-text-muted text-center">Type to search in SQL definitions...</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Detail Panel ──────────────────────────────────────────────────────── */

function DetailPanel({ item, result, onBack }: {
  item: SearchItem;
  result: import('../../api/types').AnalysisResult | null;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const table = useMemo<TableInfo | null>(() => {
    if (item.type !== 'Table' || !result?.schema) return null;
    return result.schema.tables.find((t) => t.fullName === item.name) ?? null;
  }, [item, result]);

  const view = useMemo<ViewInfo | null>(() => {
    if (item.type !== 'View' || !result?.schema) return null;
    return result.schema.views.find((v) => v.fullName === item.name) ?? null;
  }, [item, result]);

  const profile = useMemo(() => {
    if (!result?.profiles) return null;
    return result.profiles.find((p) => p.fullName === item.name) ?? null;
  }, [item, result]);

  const usage = useMemo(() => {
    if (!result?.usageAnalysis) return null;
    return result.usageAnalysis.objects.find((o) => o.objectName === item.name) ?? null;
  }, [item, result]);

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
            <span className="text-[10px] px-1 rounded bg-purple-500/20 text-purple-400">ID</span>
          )}
        </span>
      ),
    },
    { header: 'Type', accessorFn: (r) => formatColumnType(r) },
    { header: 'Nullable', accessorKey: 'isNullable', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
    { header: 'Default', accessorKey: 'defaultValue', cell: ({ getValue }) => getValue() ?? '' },
  ];

  const indexCols: ColumnDef<IndexInfo, any>[] = [
    { header: 'Index', accessorKey: 'name' },
    { header: 'Type', accessorKey: 'type' },
    { header: 'Unique', accessorKey: 'isUnique', cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
    { header: 'Columns', accessorFn: (r) => r.columns.join(', ') },
  ];

  const fkCols: ColumnDef<ForeignKeyInfo, any>[] = [
    { header: 'Name', accessorKey: 'name' },
    { header: 'Column', accessorKey: 'fromColumn' },
    { header: 'References', accessorFn: (r) => `${r.toSchema}.${r.toTable}.${r.toColumn}` },
    { header: 'Delete', accessorKey: 'deleteRule' },
  ];

  return (
    <div className="flex flex-col max-h-[75vh]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button
          onClick={onBack}
          className="text-xs text-accent hover:text-accent-hover transition-colors"
        >
          &larr; Back
        </button>
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: OBJECT_TYPE_COLORS[item.type] ?? '#666' }}
        />
        <span className="text-sm font-semibold text-text-primary">{item.name}</span>
        <span className="text-xs text-text-muted">{item.type}</span>
        {profile && (
          <span className="text-xs text-text-muted ml-auto">{profile.rowCount.toLocaleString()} rows</span>
        )}
      </div>

      {/* Content */}
      <div className="overflow-y-auto p-4 space-y-5">
        {/* Usage badge */}
        {usage && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Usage:</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              usage.usageLevel === 'active' ? 'bg-green-500/15 text-green-400' :
              usage.usageLevel === 'low' ? 'bg-yellow-500/15 text-yellow-400' :
              usage.usageLevel === 'unused' ? 'bg-red-500/15 text-red-400' :
              'bg-gray-500/15 text-gray-400'
            }`}>
              {usage.usageLevel} ({usage.score.toFixed(3)})
            </span>
          </div>
        )}

        {/* Table detail */}
        {table && (
          <>
            <div>
              <h4 className="text-xs font-medium text-text-secondary mb-2">Columns ({table.columns.length})</h4>
              <DataTable data={table.columns} columns={columnCols} searchable={false} pageSize={100} />
            </div>

            {table.indexes.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-text-secondary mb-2">Indexes ({table.indexes.length})</h4>
                <DataTable data={table.indexes} columns={indexCols} searchable={false} pageSize={50} />
              </div>
            )}

            {table.foreignKeys.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-text-secondary mb-2">Foreign Keys ({table.foreignKeys.length})</h4>
                <DataTable data={table.foreignKeys} columns={fkCols} searchable={false} pageSize={50} />
              </div>
            )}

            <TableDdl table={table} />
          </>
        )}

        {/* View detail */}
        {view && (
          <>
            {view.columns.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-text-secondary mb-2">Columns ({view.columns.length})</h4>
                <DataTable data={view.columns} columns={columnCols} searchable={false} pageSize={100} />
              </div>
            )}
          </>
        )}

        {/* SQL definition */}
        {item.definition && (
          <div>
            <h4 className="text-xs font-medium text-text-secondary mb-2">SQL Definition</h4>
            <div className="relative group/code rounded border border-border bg-bg-secondary">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(item.definition!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] bg-bg-card border border-border text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors opacity-0 group-hover/code:opacity-100"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <pre className="px-4 py-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed max-h-[40vh] overflow-y-auto select-text">
                {item.definition}
              </pre>
            </div>
          </div>
        )}

        {/* Synonym detail */}
        {item.type === 'Synonym' && result?.schema?.synonyms && (() => {
          const syn = result.schema.synonyms.find((s) => s.fullName === item.name);
          if (!syn) return null;
          return (
            <div className="text-sm text-text-secondary">
              <span className="text-text-muted">Base object:</span>{' '}
              <span className="text-text-primary">{syn.baseObjectName}</span>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ── Table DDL generator ───────────────────────────────────────────────── */

function TableDdl({ table }: { table: TableInfo }) {
  const [copied, setCopied] = useState(false);

  const ddl = useMemo(() => {
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
  }, [table]);

  return (
    <div>
      <h4 className="text-xs font-medium text-text-secondary mb-2">SQL Definition</h4>
      <div className="relative group/code rounded border border-border bg-bg-secondary">
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
        <pre className="px-4 py-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed max-h-[40vh] overflow-y-auto select-text">
          {ddl}
        </pre>
      </div>
    </div>
  );
}

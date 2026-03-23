import { useState, useMemo, useRef, useEffect, useCallback, type JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { AnalyzerLoader } from '../shared/AnalyzerLoader';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { useCodeStore } from './useCodeStore';
import { generateTableDdl, generateJobDdl } from './tableDdlGenerator';
import { useNavigate } from 'react-router-dom';

interface SearchResult {
  objectType: string;
  fullName: string;
  label: string;
  definition: string;
  matchLines: { lineNum: number; text: string }[];
  totalMatches: number;
}

export function CodeSearchPage() {
  const { status, error, progress, refresh, cancel } = useAnalyzer('schema');

  return (
    <AnalyzerLoader
      status={status}
      error={error}
      progress={progress}
      onRefresh={refresh}
      onCancel={cancel}
      analyzerName="Schema"
    >
      <CodeSearchContent />
    </AnalyzerLoader>
  );
}

const HISTORY_KEY = 'dbanalyser-code-search-history';
const MAX_HISTORY = 20;

type HistoryEntry = { query: string; isRegex: boolean; isCaseSensitive: boolean };

function connKey(serverName: string | null, databaseName: string | null): string {
  return [serverName ?? '', databaseName ?? ''].filter(Boolean).join(':') || '_global';
}

function loadAllHistory(): Record<string, HistoryEntry[]> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migration: if it's an array (old format), convert to keyed
    if (Array.isArray(parsed)) return { _global: parsed };
    return parsed;
  } catch {
    return {};
  }
}

function loadHistory(key: string): HistoryEntry[] {
  return loadAllHistory()[key] ?? [];
}

function saveToHistory(key: string, entry: HistoryEntry) {
  const all = loadAllHistory();
  const history = (all[key] ?? []).filter((h) => h.query !== entry.query);
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  all[key] = history;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
}

function clearHistory(key: string) {
  const all = loadAllHistory();
  delete all[key];
  localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
}

function CodeSearchContent() {
  const result = useStore((s) => s.result);
  const serverName = useStore((s) => s.serverName);
  const databaseName = useStore((s) => s.databaseName);
  const isServerMode = useStore((s) => s.isServerMode);
  const historyKey = connKey(serverName, databaseName);
  const openTab = useCodeStore((s) => s.openTab);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [dbFilter, setDbFilter] = useState<string>('');
  const [regexError, setRegexError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(() => loadHistory(historyKey));
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce search query (200ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Close history dropdown on outside click
  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  // Save to history when search produces results (debounced on query change)
  useEffect(() => {
    if (!query.trim() || regexError) return;
    const timer = setTimeout(() => {
      saveToHistory(historyKey, { query, isRegex, isCaseSensitive });
      setHistory(loadHistory(historyKey));
    }, 1000);
    return () => clearTimeout(timer);
  }, [query, isRegex, isCaseSensitive, regexError]);

  function applyHistoryItem(item: { query: string; isRegex: boolean; isCaseSensitive: boolean }) {
    setQuery(item.query);
    setIsRegex(item.isRegex);
    setIsCaseSensitive(item.isCaseSensitive);
    setShowHistory(false);
    // Delay focus so onFocus sees the updated query and doesn't reopen history
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleClearHistory() {
    clearHistory(historyKey);
    setHistory([]);
  }

  // Build all searchable objects
  const allObjects = useMemo(() => {
    if (!result?.schema) return [];
    const schema = result.schema;
    const items: { objectType: string; fullName: string; label: string; definition: string; databaseName?: string }[] = [];

    for (const t of schema.tables) {
      items.push({ objectType: 'Table', fullName: t.fullName, label: t.tableName, definition: generateTableDdl(t), databaseName: t.databaseName });
    }
    for (const v of schema.views) {
      items.push({ objectType: 'View', fullName: v.fullName, label: v.viewName, definition: v.definition ?? '', databaseName: v.databaseName });
    }
    for (const p of schema.storedProcedures) {
      items.push({ objectType: 'Procedure', fullName: p.fullName, label: p.procedureName, definition: p.definition ?? '', databaseName: p.databaseName });
    }
    for (const f of schema.functions) {
      items.push({ objectType: 'Function', fullName: f.fullName, label: f.functionName, definition: f.definition ?? '', databaseName: f.databaseName });
    }
    for (const t of schema.triggers) {
      items.push({ objectType: 'Trigger', fullName: t.fullName, label: t.triggerName, definition: t.definition ?? '', databaseName: t.databaseName });
    }
    for (const j of schema.jobs) {
      items.push({ objectType: 'Job', fullName: j.jobName, label: j.jobName, definition: generateJobDdl(j) });
    }

    return items;
  }, [result]);

  // Available databases (server mode)
  const databases = useMemo(() => {
    if (!isServerMode) return [];
    const dbs = new Set<string>();
    for (const obj of allObjects) {
      if (obj.databaseName) dbs.add(obj.databaseName);
    }
    return Array.from(dbs).sort();
  }, [isServerMode, allObjects]);

  // Build regex or plain matcher (uses debounced query for performance)
  const matcher = useMemo<{ regex: RegExp | null; error: string | null }>(() => {
    const q = debouncedQuery.trim();
    if (!q) return { regex: null, error: null };

    if (isRegex) {
      try {
        const flags = isCaseSensitive ? 'g' : 'gi';
        const re = new RegExp(q, flags);
        return { regex: re, error: null };
      } catch (e: any) {
        return { regex: null, error: e.message ?? 'Invalid regex' };
      }
    }

    // Plain text: escape for regex use
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = isCaseSensitive ? 'g' : 'gi';
    return { regex: new RegExp(escaped, flags), error: null };
  }, [debouncedQuery, isRegex, isCaseSensitive]);

  // Update error state
  useEffect(() => {
    setRegexError(matcher.error);
  }, [matcher.error]);

  // Search results
  const results = useMemo<SearchResult[]>(() => {
    if (!matcher.regex) return [];
    const re = matcher.regex;

    const matched: SearchResult[] = [];
    for (const obj of allObjects) {
      if (typeFilter.size > 0 && !typeFilter.has(obj.objectType)) continue;
      if (dbFilter && obj.databaseName !== dbFilter) continue;
      if (!obj.definition) continue;

      const lines = obj.definition.split('\n');
      const matchLines: { lineNum: number; text: string }[] = [];
      let totalMatches = 0;

      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        const lineMatches = lines[i].match(new RegExp(re.source, re.flags));
        if (lineMatches && lineMatches.length > 0) {
          matchLines.push({ lineNum: i + 1, text: lines[i] });
          totalMatches += lineMatches.length;
        }
      }

      if (matchLines.length > 0) {
        matched.push({
          ...obj,
          matchLines: matchLines.slice(0, 5),
          totalMatches,
        });
      }
    }

    matched.sort((a, b) => b.totalMatches - a.totalMatches);
    return matched;
  }, [allObjects, matcher.regex, typeFilter, dbFilter]);

  // All available object type counts (for pre-search filter)
  const allTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const obj of allObjects) {
      counts[obj.objectType] = (counts[obj.objectType] ?? 0) + 1;
    }
    return counts;
  }, [allObjects]);

  // Type counts from search results
  const resultTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.objectType] = (counts[r.objectType] ?? 0) + 1;
    }
    return counts;
  }, [results]);

  // Always show all types, but display result counts when searching
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [type, total] of Object.entries(allTypeCounts)) {
      counts[type] = query.trim() && !regexError ? (resultTypeCounts[type] ?? 0) : total;
    }
    return counts;
  }, [allTypeCounts, resultTypeCounts, query, regexError]);

  const totalMatches = useMemo(
    () => results.reduce((sum, r) => sum + r.totalMatches, 0),
    [results]
  );

  function toggleType(type: string) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function openInCode(item: SearchResult, lineNum?: number) {
    openTab({
      objectType: item.objectType,
      fullName: item.fullName,
      label: item.label,
      definition: item.definition,
      goToLine: lineNum,
    });
    navigate('/code');
  }

  function highlightCode(text: string): JSX.Element {
    if (!matcher.regex) return <>{text}</>;
    const parts: (string | JSX.Element)[] = [];
    const re = new RegExp(matcher.regex.source, matcher.regex.flags);
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      if (match[0].length === 0) { re.lastIndex++; continue; } // prevent infinite loop on zero-length match
      if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
      parts.push(
        <span key={key++} className="bg-accent/30 text-accent rounded px-0.5">
          {match[0]}
        </span>
      );
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < text.length) parts.push(text.slice(lastIdx));
    return <>{parts}</>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xl" ref={historyRef}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowHistory(false); }}
              onFocus={() => { if (!query && history.length > 0) setShowHistory(true); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && !query && history.length > 0) {
                  setShowHistory(true);
                }
              }}
              placeholder={isRegex ? 'Search with regex pattern...' : 'Search across all SQL definitions...'}
              className={`w-full px-4 py-2.5 pr-16 bg-bg-card border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 ${
                regexError ? 'border-severity-error' : 'border-border'
              }`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {history.length > 0 && (
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="text-text-muted hover:text-text-primary text-xs transition-colors"
                  title="Search history"
                >
                  &#9776;
                </button>
              )}
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="text-text-muted hover:text-text-primary text-sm"
                >
                  &times;
                </button>
              )}
            </div>

            {/* History dropdown */}
            {showHistory && history.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-lg shadow-2xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider">Recent searches</span>
                  <button
                    onClick={handleClearHistory}
                    className="text-[10px] text-text-muted hover:text-text-primary transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {history.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => applyHistoryItem(item)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                    >
                      <span className="font-mono truncate flex-1 text-left">{item.query}</span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        {item.isRegex && (
                          <span className="text-[9px] px-1 rounded bg-accent/15 text-accent">.*</span>
                        )}
                        {item.isCaseSensitive && (
                          <span className="text-[9px] px-1 rounded bg-accent/15 text-accent">Aa</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Search mode toggles */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsRegex(!isRegex)}
              className={`px-2 py-1.5 rounded text-[11px] font-mono transition-colors border ${
                isRegex
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'text-text-muted border-border hover:text-text-secondary hover:border-text-muted'
              }`}
              title="Use regular expressions"
            >
              .*
            </button>
            <button
              onClick={() => setIsCaseSensitive(!isCaseSensitive)}
              className={`px-2 py-1.5 rounded text-[11px] font-mono transition-colors border ${
                isCaseSensitive
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'text-text-muted border-border hover:text-text-secondary hover:border-text-muted'
              }`}
              title="Match case"
            >
              Aa
            </button>
          </div>

          {query && !regexError && (
            <span className="text-xs text-text-muted">
              {totalMatches} match{totalMatches !== 1 ? 'es' : ''} in {results.length} object{results.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Regex error */}
        {regexError && (
          <div className="text-xs text-severity-error">
            Invalid regex: {regexError}
          </div>
        )}

        {/* Database filter (server mode) */}
        {isServerMode && databases.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted uppercase tracking-wider">Database:</span>
            <select
              value={dbFilter}
              onChange={(e) => setDbFilter(e.target.value)}
              className="bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary"
            >
              <option value="">All databases</option>
              {databases.map((db) => (
                <option key={db} value={db}>{db}</option>
              ))}
            </select>
          </div>
        )}

        {/* Type filter chips */}
        {Object.keys(typeCounts).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-text-muted uppercase tracking-wider">Filter:</span>
            {Object.entries(typeCounts).map(([type, count]) => {
              const active = typeFilter.size === 0 || typeFilter.has(type);
              const color = OBJECT_TYPE_COLORS[type] ?? '#666';
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors ${
                    active
                      ? 'bg-bg-card text-text-primary border border-border'
                      : 'text-text-muted border border-transparent hover:border-border'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  {type}{count > 0 ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Results */}
      <ResultsList
        results={results}
        query={query}
        regexError={regexError}
        historyCount={history.length}
        highlightCode={highlightCode}
        openInCode={openInCode}
      />
    </div>
  );
}

// ── Virtualized results list ──

function ResultsList({
  results,
  query,
  regexError,
  historyCount,
  highlightCode,
  openInCode,
}: {
  results: SearchResult[];
  query: string;
  regexError: string | null;
  historyCount: number;
  highlightCode: (text: string) => JSX.Element | string;
  openInCode: (item: SearchResult, lineNum?: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Estimate row height: header (40px) + matchLines * 24px + overflow line
  const getItemSize = useCallback((index: number) => {
    const item = results[index];
    const lines = Math.min(item.matchLines.length, 10);
    const overflow = item.matchLines.length < item.totalMatches ? 24 : 0;
    return 40 + lines * 24 + overflow;
  }, [results]);

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: getItemSize,
    overscan: 5,
  });

  if (!query.trim()) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        <div className="text-center space-y-2">
          <div className="text-2xl">&#128270;</div>
          <p>Search across all stored procedures, functions, views, triggers, and jobs</p>
          <p className="text-[11px]">
            Toggle <span className="font-mono bg-bg-card px-1 rounded">.*</span> for regex,{' '}
            <span className="font-mono bg-bg-card px-1 rounded">Aa</span> for case-sensitive.
            {historyCount > 0 && ' Recent searches shown on focus.'}
          </p>
        </div>
      </div>
    );
  }

  if (!regexError && results.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center h-48 text-text-muted text-sm">
        No matches found for &ldquo;{query}&rdquo;
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = results[virtualRow.index];
          const color = OBJECT_TYPE_COLORS[item.objectType] ?? '#666';
          return (
            <div
              key={item.fullName}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="border-b border-border/50"
            >
              {/* Object header */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-secondary/50">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-sm font-medium text-text-primary">{item.fullName}</span>
                <span className="text-[10px] text-text-muted">{item.objectType}</span>
                <span className="text-[10px] text-text-muted ml-auto">
                  {item.totalMatches} match{item.totalMatches !== 1 ? 'es' : ''}
                </span>
                <button
                  onClick={() => openInCode(item)}
                  className="text-[10px] text-accent hover:text-accent-hover transition-colors"
                >
                  Open in Code &rarr;
                </button>
              </div>

              {/* Matching lines */}
              <div className="bg-bg-primary">
                {item.matchLines.slice(0, 10).map((ml, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 px-4 py-1 hover:bg-bg-hover/30 transition-colors cursor-pointer"
                    onClick={() => openInCode(item, ml.lineNum)}
                  >
                    <span className="text-[10px] text-text-muted w-8 text-right flex-shrink-0 pt-0.5 font-mono">
                      {ml.lineNum}
                    </span>
                    <span className="text-xs font-mono text-text-secondary truncate">
                      {highlightCode(ml.text.trim())}
                    </span>
                  </div>
                ))}
                {item.matchLines.length < item.totalMatches && (
                  <div className="px-4 py-1 text-[10px] text-text-muted">
                    ... and {item.totalMatches - item.matchLines.length} more match{item.totalMatches - item.matchLines.length !== 1 ? 'es' : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

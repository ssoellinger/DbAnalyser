import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { sql, MSSQL, PostgreSQL, type SQLNamespace } from '@codemirror/lang-sql';
import { bracketMatching } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { search, highlightSelectionMatches } from '@codemirror/search';
import { defaultKeymap, history as cmHistory, historyKeymap } from '@codemirror/commands';
import { format as formatSql } from 'sql-formatter';
import { dbAnalyserEditorTheme, dbAnalyserHighlighting } from '../code/codemirrorTheme';
import { QueryResultsGrid } from './QueryResultsGrid';
import { ExecutionPlanView } from './ExecutionPlanView';
import { ColumnStats } from './ColumnStats';
import { IoStatsView, hasIoStats } from './IoStatsView';
import { useStore } from '../../hooks/useStore';
import { api } from '../../api/client';
import type { QueryResponse, QueryHistoryEntry, DatabaseSchema } from '../../api/types';

const MAX_ROWS_OPTIONS = [100, 500, 1000, 5000, 10000, 0];
const HISTORY_KEY_PREFIX = 'dbanalyser-query-history';
const SAVED_QUERIES_KEY_PREFIX = 'dbanalyser-saved-queries';
const MAX_HISTORY = 50;
const MIN_EDITOR_HEIGHT = 80;
const MIN_RESULTS_HEIGHT = 80;

function historyKey(server: string | null): string {
  const suffix = server ? `-${server.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
  return `${HISTORY_KEY_PREFIX}${suffix}`;
}

function savedQueriesKey(server: string | null): string {
  const suffix = server ? `-${server.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
  return `${SAVED_QUERIES_KEY_PREFIX}${suffix}`;
}

// ── Types ──

interface QueryTab {
  id: string;
  title: string;
  sql: string;
}

interface SavedQuery {
  name: string;
  sql: string;
  savedAt: string;
}

interface PinnedResult {
  id: string;
  sql: string;
  response: QueryResponse;
  pinnedAt: string;
}

// ── Persistence helpers ──

function loadHistory(key: string): QueryHistoryEntry[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(key: string, entries: QueryHistoryEntry[]) {
  try { localStorage.setItem(key, JSON.stringify(entries.slice(0, MAX_HISTORY))); } catch {}
}

function loadSavedQueries(key: string): SavedQuery[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSavedQueries(key: string, queries: SavedQuery[]) {
  try { localStorage.setItem(key, JSON.stringify(queries)); } catch {}
}

// ── SQL statement splitting ──

/** Find the SQL statement at the cursor position, delimited by GO or semicolons. */
function getStatementAtCursor(text: string, cursorPos: number): string {
  // Split on GO (on its own line) or semicolons
  const parts: { start: number; end: number; text: string }[] = [];
  const goRegex = /^GO\s*$/gim;
  let lastEnd = 0;

  let match;
  while ((match = goRegex.exec(text)) !== null) {
    if (match.index > lastEnd) {
      const chunk = text.slice(lastEnd, match.index);
      parts.push({ start: lastEnd, end: match.index, text: chunk });
    }
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < text.length) {
    parts.push({ start: lastEnd, end: text.length, text: text.slice(lastEnd) });
  }

  // If no GO found, fall back to semicolons
  if (parts.length <= 1) {
    const semiParts: { start: number; end: number; text: string }[] = [];
    let semiLast = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ';') {
        semiParts.push({ start: semiLast, end: i + 1, text: text.slice(semiLast, i + 1) });
        semiLast = i + 1;
      }
    }
    if (semiLast < text.length) {
      semiParts.push({ start: semiLast, end: text.length, text: text.slice(semiLast) });
    }
    if (semiParts.length > 1) {
      for (const part of semiParts) {
        if (cursorPos >= part.start && cursorPos <= part.end && part.text.trim()) {
          return part.text.trim();
        }
      }
    }
  }

  // Find which part the cursor is in
  for (const part of parts) {
    if (cursorPos >= part.start && cursorPos <= part.end && part.text.trim()) {
      return part.text.trim();
    }
  }

  return text.trim();
}

// ── Schema builder ──

function buildSqlSchema(schema: DatabaseSchema | null | undefined, database?: string): SQLNamespace {
  if (!schema) return {};
  const matchesDb = (objDb?: string) => !database || !objDb || objDb.toLowerCase() === database.toLowerCase();
  const ns: Record<string, Record<string, string[]>> = {};

  for (const table of schema.tables) {
    if (!matchesDb(table.databaseName)) continue;
    const s = table.schemaName || 'dbo';
    if (!ns[s]) ns[s] = {};
    ns[s][table.tableName] = table.columns.map((c) => c.name);
  }
  for (const view of schema.views) {
    if (!matchesDb(view.databaseName)) continue;
    const s = view.schemaName || 'dbo';
    if (!ns[s]) ns[s] = {};
    ns[s][view.viewName] = view.columns.map((c) => c.name);
  }
  for (const proc of schema.storedProcedures) {
    if (!matchesDb(proc.databaseName)) continue;
    const s = proc.schemaName || 'dbo';
    if (!ns[s]) ns[s] = {};
    ns[s][proc.procedureName] = [];
  }
  for (const func of schema.functions) {
    if (!matchesDb(func.databaseName)) continue;
    const s = func.schemaName || 'dbo';
    if (!ns[s]) ns[s] = {};
    ns[s][func.functionName] = [];
  }
  return ns;
}

// ── Compartment for SQL schema ──
const sqlCompartment = new Compartment();

// ── Results view type ──
type ResultsView = 'results' | 'messages' | 'plan' | 'statistics' | 'performance';

// ── Component ──

let tabCounter = 1;

export function QueryPage() {
  const sessionId = useStore((s) => s.sessionId);
  const isFileSession = useStore((s) => s.isFileSession);
  const providerType = useStore((s) => s.providerType);
  const dbSchema = useStore((s) => s.result?.schema);
  const serverName = useStore((s) => s.serverName);

  // Connection-scoped storage keys
  const hKey = useMemo(() => historyKey(serverName), [serverName]);
  const sqKey = useMemo(() => savedQueriesKey(serverName), [serverName]);

  // Query tabs
  const [tabs, setTabs] = useState<QueryTab[]>([{ id: 'tab-1', title: 'Query 1', sql: '-- Write your SQL query here\n' }]);
  const [activeTabId, setActiveTabId] = useState('tab-1');

  const [maxRows, setMaxRows] = useState(1000);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState(0);
  const [resultsView, setResultsView] = useState<ResultsView>('results');
  const [history, setHistory] = useState<QueryHistoryEntry[]>(() => loadHistory(hKey));
  const [showHistory, setShowHistory] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [editorHeightPct, setEditorHeightPct] = useState(40);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => loadSavedQueries(sqKey));
  const [showSaved, setShowSaved] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveQueryName, setSaveQueryName] = useState('');
  const [executionStartTime, setExecutionStartTime] = useState<number | null>(null);
  const [elapsedDisplay, setElapsedDisplay] = useState('');
  const [pinnedResults, setPinnedResults] = useState<PinnedResult[]>([]);
  const [transactionState, setTransactionState] = useState<'none' | 'active'>('none');

  const abortRef = useRef<AbortController | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Persist editor content when switching tabs
  const saveCurrentTabSql = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentSql = view.state.doc.toString();
    setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, sql: currentSql } : t));
  }, [activeTabId]);

  // Fetch available databases on mount
  useEffect(() => {
    if (!sessionId || isFileSession) return;
    api.getQueryDatabases(sessionId).then(({ databases: dbs, currentDatabase }) => {
      setDatabases(dbs);
      setSelectedDb(currentDatabase ?? '');
    }).catch(() => {});
  }, [sessionId, isFileSession]);

  // Reload history & saved queries when connection changes
  useEffect(() => {
    setHistory(loadHistory(hKey));
    setSavedQueries(loadSavedQueries(sqKey));
  }, [hKey, sqKey]);

  // ── Elapsed timer ──
  useEffect(() => {
    if (executionStartTime === null) return;
    const id = setInterval(() => {
      const ms = Date.now() - executionStartTime;
      if (ms < 1000) setElapsedDisplay(`${ms}ms`);
      else setElapsedDisplay(`${(ms / 1000).toFixed(1)}s`);
    }, 100);
    return () => clearInterval(id);
  }, [executionStartTime]);

  // ── Execute ──
  const executeQuery = useCallback(async (sqlOverride?: string, showPlan = false, showStats = false) => {
    if (!sessionId || isFileSession) return;
    const view = viewRef.current;
    if (!view) return;

    const selection = view.state.selection.main;
    const sqlText = sqlOverride ??
      (selection.from !== selection.to
        ? view.state.sliceDoc(selection.from, selection.to)
        : view.state.doc.toString());

    if (!sqlText.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsExecuting(true);
    setExecutionStartTime(Date.now());
    setResponse(null);
    setActiveResultTab(0);
    setResultsView(showPlan ? 'plan' : showStats ? 'performance' : 'results');

    try {
      const result = await api.executeQuery(sessionId, sqlText, maxRows || 1000000, 30, selectedDb || undefined, showPlan, showStats, controller.signal);
      setResponse(result);

      const totalRows = result.resultSets.reduce((sum, rs) => sum + rs.totalRowsReturned, 0);
      const entry: QueryHistoryEntry = {
        sql: sqlText.length > 500 ? sqlText.slice(0, 500) + '...' : sqlText,
        executedAt: new Date().toISOString(),
        elapsedMs: result.elapsedMs,
        rowCount: totalRows,
        error: result.error,
        database: selectedDb || null,
      };
      setHistory((prev) => {
        const next = [entry, ...prev].slice(0, MAX_HISTORY);
        saveHistory(hKey, next);
        return next;
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResponse({ resultSets: [], elapsedMs: 0, error: err instanceof Error ? err.message : 'Query failed' });
    } finally {
      setIsExecuting(false);
      setExecutionStartTime(null);
      abortRef.current = null;
    }
  }, [sessionId, isFileSession, maxRows, selectedDb, hKey]);

  const executeCurrentStatement = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const cursorPos = view.state.selection.main.head;
    const fullText = view.state.doc.toString();
    const statement = getStatementAtCursor(fullText, cursorPos);
    if (statement) executeQuery(statement);
  }, [executeQuery]);

  const cancelQuery = useCallback(() => { abortRef.current?.abort(); setIsExecuting(false); }, []);
  const clearResults = useCallback(() => { setResponse(null); setActiveResultTab(0); }, []);

  const formatQuery = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentSql = view.state.doc.toString();
    if (!currentSql.trim()) return;
    try {
      const language = providerType === 'postgresql' ? 'postgresql' as const : 'tsql' as const;
      const formatted = formatSql(currentSql, { language, tabWidth: 2, keywordCase: 'upper' });
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
    } catch {}
  }, [providerType]);

  // ── Tab management ──
  const addTab = useCallback(() => {
    saveCurrentTabSql();
    tabCounter++;
    const newTab: QueryTab = { id: `tab-${Date.now()}`, title: `Query ${tabCounter}`, sql: '' };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setResponse(null);
  }, [saveCurrentTabSql]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const filtered = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(filtered[filtered.length - 1].id);
        setResponse(null);
      }
      return filtered;
    });
  }, [activeTabId]);

  const switchTab = useCallback((id: string) => {
    if (id === activeTabId) return;
    saveCurrentTabSql();
    setActiveTabId(id);
    setResponse(null);
  }, [activeTabId, saveCurrentTabSql]);

  // ── Save/Load queries ──
  const saveCurrentQuery = useCallback(() => {
    const view = viewRef.current;
    if (!view || !saveQueryName.trim()) return;
    const sqlText = view.state.doc.toString();
    const entry: SavedQuery = { name: saveQueryName.trim(), sql: sqlText, savedAt: new Date().toISOString() };
    setSavedQueries((prev) => {
      const next = [entry, ...prev.filter((q) => q.name !== entry.name)];
      saveSavedQueries(sqKey, next);
      return next;
    });
    setShowSaveDialog(false);
    setSaveQueryName('');
  }, [saveQueryName]);

  const loadQuery = useCallback((q: SavedQuery) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: q.sql } });
    setShowSaved(false);
  }, []);

  const deleteSavedQuery = useCallback((name: string) => {
    setSavedQueries((prev) => {
      const next = prev.filter((q) => q.name !== name);
      saveSavedQueries(sqKey, next);
      return next;
    });
  }, []);

  // ── Pin results ──
  const pinCurrentResult = useCallback(() => {
    if (!response || response.error || pinnedResults.length >= 3) return;
    const view = viewRef.current;
    const sqlText = view ? view.state.doc.toString() : '';
    const pinned: PinnedResult = {
      id: `pin-${Date.now()}`,
      sql: sqlText.length > 100 ? sqlText.slice(0, 100) + '...' : sqlText,
      response,
      pinnedAt: new Date().toISOString(),
    };
    setPinnedResults((prev) => [...prev, pinned]);
  }, [response, pinnedResults.length]);

  const unpinResult = useCallback((id: string) => {
    setPinnedResults((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ── Transaction controls ──
  const beginTransaction = useCallback(async () => {
    if (!sessionId || transactionState === 'active') return;
    try {
      await api.beginTransaction(sessionId, selectedDb || undefined);
      setTransactionState('active');
    } catch (err) {
      setResponse({ resultSets: [], elapsedMs: 0, error: err instanceof Error ? err.message : 'Failed to begin transaction' });
    }
  }, [sessionId, transactionState, selectedDb]);

  const commitTransaction = useCallback(async () => {
    if (!sessionId || transactionState !== 'active') return;
    try {
      await api.commitTransaction(sessionId);
      setTransactionState('none');
    } catch (err) {
      setResponse({ resultSets: [], elapsedMs: 0, error: err instanceof Error ? err.message : 'Failed to commit transaction' });
    }
  }, [sessionId, transactionState]);

  const rollbackTransaction = useCallback(async () => {
    if (!sessionId || transactionState !== 'active') return;
    try {
      await api.rollbackTransaction(sessionId);
      setTransactionState('none');
    } catch (err) {
      setResponse({ resultSets: [], elapsedMs: 0, error: err instanceof Error ? err.message : 'Failed to rollback transaction' });
    }
  }, [sessionId, transactionState]);

  // Warn before closing with active transaction
  useEffect(() => {
    if (transactionState !== 'active') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [transactionState]);

  // Rollback on unmount if transaction active
  useEffect(() => {
    return () => {
      if (transactionState === 'active' && sessionId) {
        api.rollbackTransaction(sessionId).catch(() => {});
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── CodeMirror setup ──
  const sqlSchema = useMemo(() => buildSqlSchema(dbSchema, selectedDb), [dbSchema, selectedDb]);
  const sqlDialect = providerType === 'postgresql' ? PostgreSQL : MSSQL;

  const extensions = useMemo(() => [
    lineNumbers(),
    highlightActiveLine(),
    bracketMatching(),
    closeBrackets(),
    cmHistory(),
    search(),
    highlightSelectionMatches(),
    autocompletion({ defaultKeymap: true, activateOnTyping: true }),
    sqlCompartment.of(sql({ dialect: sqlDialect, schema: sqlSchema })),
    dbAnalyserEditorTheme,
    dbAnalyserHighlighting,
    keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, ...completionKeymap]),
    EditorView.lineWrapping,
  ], [sqlDialect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load active tab's SQL into editor
  const activeTabSql = tabs.find((t) => t.id === activeTabId)?.sql ?? '';

  useEffect(() => {
    if (!editorContainerRef.current) return;
    const state = EditorState.create({ doc: activeTabSql, extensions });
    const view = new EditorView({ state, parent: editorContainerRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [extensions, activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: sqlCompartment.reconfigure(sql({ dialect: sqlDialect, schema: sqlSchema })) });
  }, [sqlSchema, sqlDialect]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'Enter') { e.preventDefault(); executeQuery(); }
        else if (e.key === 'l') { e.preventDefault(); clearResults(); }
        else if (e.key === 'd') { e.preventDefault(); executeCurrentStatement(); }
        else if (e.key === 's') { e.preventDefault(); setShowSaveDialog(true); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [executeQuery, clearResults, executeCurrentStatement]);

  const restoreFromHistory = useCallback((entry: QueryHistoryEntry) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: entry.sql } });
    if (entry.database && databases.includes(entry.database)) {
      setSelectedDb(entry.database);
    }
    setShowHistory(false);
  }, [databases]);

  // ── Resizable split ──
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const startY = e.clientY;
    const containerHeight = container.getBoundingClientRect().height;
    const startPct = editorHeightPct;

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const deltaPct = (dy / containerHeight) * 100;
      setEditorHeightPct(Math.max(
        (MIN_EDITOR_HEIGHT / containerHeight) * 100,
        Math.min(100 - (MIN_RESULTS_HEIGHT / containerHeight) * 100, startPct + deltaPct),
      ));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [editorHeightPct]);

  if (isFileSession) {
    return <div className="flex items-center justify-center h-full text-text-muted">Query execution is not available in file-session mode.</div>;
  }

  const totalRows = response?.resultSets.reduce((sum, rs) => sum + rs.totalRowsReturned, 0) ?? 0;
  const anyTruncated = response?.resultSets.some((rs) => rs.truncated) ?? false;
  const hasSchema = !!dbSchema;
  const hasMessages = (response?.messages?.length ?? 0) > 0;
  const hasPlan = !!response?.executionPlan;
  const hasIo = hasMessages && hasIoStats(response?.messages ?? []);

  return (
    <div className="flex flex-col h-full" ref={splitContainerRef}>
      {/* Warning banner */}
      <div className="bg-amber-900/30 border-b border-amber-700/50 px-4 py-1.5 text-xs text-amber-300 flex items-center gap-2">
        <span>&#9888;</span>
        <span>Queries execute directly against the database. Use caution with UPDATE, DELETE, and DROP statements.</span>
      </div>

      {/* Editor section */}
      <div className="flex-shrink-0" style={{ height: `${editorHeightPct}%`, minHeight: MIN_EDITOR_HEIGHT }}>
        {/* Query tabs */}
        <div className="flex items-center bg-bg-secondary border-b border-border px-1">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-b-2 transition-colors ${
                tab.id === activeTabId
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
              onClick={() => switchTab(tab.id)}
            >
              <span>{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className="ml-1 text-text-muted hover:text-text-primary text-[10px]"
                >
                  &#10005;
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addTab}
            className="px-2 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
            title="New query tab"
          >
            +
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border">
          <button onClick={() => executeQuery()} disabled={isExecuting}
            className="px-3 py-1 text-xs font-medium rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-50 transition-colors flex items-center gap-1.5">
            {isExecuting ? <><span className="animate-spin">&#9696;</span> Running...</> : <>&#9655; Execute</>}
          </button>

          {isExecuting && (
            <button onClick={cancelQuery}
              className="px-3 py-1 text-xs font-medium rounded border border-severity-error text-severity-error hover:bg-severity-error/10 transition-colors">
              Cancel
            </button>
          )}

          {/* Transaction controls */}
          {transactionState === 'none' ? (
            <button onClick={beginTransaction} disabled={isExecuting}
              className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-50 transition-colors"
              title="Begin a new transaction">
              BEGIN
            </button>
          ) : (
            <>
              <button onClick={commitTransaction} disabled={isExecuting}
                className="px-2 py-1 text-xs rounded border border-green-600 text-green-400 hover:bg-green-600/10 disabled:opacity-50 transition-colors"
                title="Commit the active transaction">
                COMMIT
              </button>
              <button onClick={rollbackTransaction} disabled={isExecuting}
                className="px-2 py-1 text-xs rounded border border-severity-error text-severity-error hover:bg-severity-error/10 disabled:opacity-50 transition-colors"
                title="Rollback the active transaction">
                ROLLBACK
              </button>
              <span className="px-2 py-0.5 text-xs rounded bg-amber-600/20 text-amber-400 border border-amber-600/40">
                Transaction Active
              </span>
            </>
          )}

          <div className="w-px h-5 bg-border" />

          <button onClick={() => executeQuery(undefined, true)} disabled={isExecuting}
            className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Show execution plan">
            Plan
          </button>

          {providerType !== 'postgresql' && (
            <button onClick={() => executeQuery(undefined, false, true)} disabled={isExecuting}
              className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="Execute with STATISTICS IO (shows table read counts)">
              IO Stats
            </button>
          )}

          <button onClick={formatQuery}
            className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Format SQL">
            Format
          </button>

          <label className="flex items-center gap-1.5 text-xs text-text-secondary ml-1">
            Max:
            <select value={maxRows} onChange={(e) => setMaxRows(Number(e.target.value))}
              className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary">
              {MAX_ROWS_OPTIONS.map((n) => <option key={n} value={n}>{n === 0 ? 'All' : n.toLocaleString()}</option>)}
            </select>
          </label>

          {databases.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-text-secondary ml-1">
              DB:
              <select value={selectedDb} onChange={(e) => setSelectedDb(e.target.value)}
                className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary max-w-[150px]">
                {databases.map((db) => <option key={db} value={db}>{db}</option>)}
              </select>
            </label>
          )}

          {/* Save / Load */}
          <div className="relative ml-1">
            <button onClick={() => setShowSaveDialog(true)}
              className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="Save query (Ctrl+S)">
              Save
            </button>
          </div>
          <div className="relative">
            <button onClick={() => setShowSaved(!showSaved)} disabled={savedQueries.length === 0}
              className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 transition-colors">
              Load ({savedQueries.length})
            </button>
            {showSaved && savedQueries.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-80 max-h-64 overflow-y-auto bg-bg-secondary border border-border rounded shadow-lg z-50">
                {savedQueries.map((q) => (
                  <div key={q.name} className="flex items-center px-3 py-2 text-xs hover:bg-bg-hover border-b border-border/50 transition-colors">
                    <button onClick={() => loadQuery(q)} className="flex-1 text-left">
                      <div className="text-text-primary font-medium">{q.name}</div>
                      <div className="text-text-muted truncate mt-0.5 font-mono">{q.sql.slice(0, 80)}</div>
                    </button>
                    <button onClick={() => deleteSavedQuery(q.name)} className="ml-2 text-text-muted hover:text-severity-error text-[10px]">&#10005;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* History */}
          <div className="relative">
            <button onClick={() => setShowHistory(!showHistory)} disabled={history.length === 0}
              className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 transition-colors">
              History
            </button>
            {showHistory && history.length > 0 && (
              <div className="absolute top-full right-0 mt-1 w-96 max-h-64 overflow-y-auto bg-bg-secondary border border-border rounded shadow-lg z-50">
                {history.map((entry, i) => (
                  <button key={i} onClick={() => restoreFromHistory(entry)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover border-b border-border/50 transition-colors">
                    <div className="font-mono text-text-primary truncate">{entry.sql}</div>
                    <div className="text-text-muted mt-0.5">
                      {entry.database && <span className="text-accent">[{entry.database}]</span>}
                      {entry.database && ' \u00B7 '}
                      {new Date(entry.executedAt).toLocaleString()} &middot; {entry.elapsedMs}ms
                      {entry.error ? <span className="text-severity-error"> &middot; Error</span> : <> &middot; {entry.rowCount} rows</>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="ml-auto text-xs text-text-muted flex items-center gap-2">
            {hasSchema && <span className="text-green-400" title="Autocomplete active">&#10003;</span>}
            <span>Ctrl+Enter run &middot; Ctrl+D statement &middot; Ctrl+S save</span>
          </span>
        </div>

        {/* Editor */}
        <div ref={editorContainerRef}
          className="h-[calc(100%-68px)] w-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto" />
      </div>

      {/* Drag handle */}
      <div onMouseDown={handleDragStart}
        className="h-1.5 bg-bg-secondary hover:bg-accent/40 cursor-row-resize transition-colors flex-shrink-0 flex items-center justify-center">
        <div className="w-8 h-0.5 bg-border rounded" />
      </div>

      {/* Results section */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Results view selector + status */}
        {response && (
          <div className="flex items-center bg-bg-secondary border-b border-border text-xs">
            <button onClick={() => setResultsView('results')}
              className={`px-3 py-1.5 border-b-2 transition-colors ${resultsView === 'results' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
              Results
            </button>
            <button onClick={() => setResultsView('messages')}
              className={`px-3 py-1.5 border-b-2 transition-colors ${resultsView === 'messages' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
              Messages{hasMessages ? ` (${response.messages!.length})` : ''}
            </button>
            {hasPlan && (
              <button onClick={() => setResultsView('plan')}
                className={`px-3 py-1.5 border-b-2 transition-colors ${resultsView === 'plan' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                Plan
              </button>
            )}
            {response.resultSets.length > 0 && !response.error && (
              <button onClick={() => setResultsView('statistics')}
                className={`px-3 py-1.5 border-b-2 transition-colors ${resultsView === 'statistics' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                Statistics
              </button>
            )}
            {hasIo && (
              <button onClick={() => setResultsView('performance')}
                className={`px-3 py-1.5 border-b-2 transition-colors ${resultsView === 'performance' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                IO Stats
              </button>
            )}

            <div className="ml-auto px-3 py-1.5 flex items-center gap-3">
              {response.error ? (
                <span className="text-severity-error">Error</span>
              ) : (
                <>
                  <span className="text-text-secondary">
                    {totalRows.toLocaleString()} row{totalRows !== 1 ? 's' : ''} &middot; {response.elapsedMs}ms
                  </span>
                  {anyTruncated && <span className="text-amber-400">&#9888; Truncated</span>}
                  <button
                    onClick={pinCurrentResult}
                    disabled={pinnedResults.length >= 3}
                    className="px-2 py-0.5 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 transition-colors"
                    title={pinnedResults.length >= 3 ? 'Max 3 pinned results' : 'Pin these results'}
                  >
                    Pin
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Result set sub-tabs */}
        {resultsView === 'results' && response && !response.error && response.resultSets.length > 1 && (
          <div className="flex border-b border-border bg-bg-secondary px-2">
            {response.resultSets.map((rs, i) => (
              <button key={i} onClick={() => setActiveResultTab(i)}
                className={`px-3 py-1.5 text-xs transition-colors border-b-2 ${activeResultTab === i ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                Result {i + 1} ({rs.totalRowsReturned})
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-3">
          {!response && !isExecuting && (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Write a query and press Execute or Ctrl+Enter
            </div>
          )}

          {isExecuting && (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              <span className="animate-spin mr-2">&#9696;</span> Running for {elapsedDisplay || '0ms'}...
            </div>
          )}

          {response && resultsView === 'results' && !response.error && response.resultSets.length > 0 && (
            <QueryResultsGrid resultSet={response.resultSets[activeResultTab]} />
          )}

          {response && resultsView === 'results' && !response.error && response.resultSets.length === 0 && !response.error && (
            <div className="text-text-muted text-sm">
              {hasMessages ? 'Query completed. See Messages tab.' : 'Query completed successfully. No result sets returned.'}
            </div>
          )}

          {response && resultsView === 'messages' && (
            <div className="space-y-1 font-mono text-xs">
              {(response.messages ?? []).length > 0 ? (
                response.messages!.map((msg, i) => (
                  <div key={i} className="text-text-secondary">{msg}</div>
                ))
              ) : (
                <div className="text-text-muted">No messages.</div>
              )}
            </div>
          )}

          {response && resultsView === 'plan' && (
            <ExecutionPlanView planText={response.executionPlan ?? ''} providerType={providerType} />
          )}

          {response && resultsView === 'statistics' && !response.error && response.resultSets.length > 0 && (
            <ColumnStats resultSet={response.resultSets[activeResultTab]} />
          )}

          {response && resultsView === 'performance' && hasIo && (
            <IoStatsView messages={response.messages ?? []} />
          )}

          {response && response.error && resultsView === 'results' && (
            <div className="bg-severity-error/10 border border-severity-error/30 rounded p-4 text-sm text-severity-error">
              <div className="font-medium mb-1">Query Error</div>
              <pre className="whitespace-pre-wrap font-mono text-xs">{response.error}</pre>
            </div>
          )}

          {/* Pinned results */}
          {pinnedResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {pinnedResults.map((pin) => (
                <details key={pin.id} className="border border-border rounded bg-bg-secondary">
                  <summary className="px-3 py-2 text-xs cursor-pointer hover:bg-bg-hover transition-colors flex items-center gap-2">
                    <span className="text-accent font-medium">Pinned</span>
                    <span className="text-text-muted font-mono truncate flex-1">{pin.sql}</span>
                    <span className="text-text-secondary">{pin.response.elapsedMs}ms</span>
                    <button
                      onClick={(e) => { e.preventDefault(); unpinResult(pin.id); }}
                      className="text-text-muted hover:text-severity-error text-[10px] ml-1"
                      title="Unpin"
                    >
                      &#10005;
                    </button>
                  </summary>
                  <div className="p-3 border-t border-border">
                    {pin.response.resultSets.length > 0 && (
                      <QueryResultsGrid resultSet={pin.response.resultSets[0]} />
                    )}
                    {pin.response.resultSets.length === 0 && (
                      <div className="text-text-muted text-xs">No result sets.</div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Save query dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSaveDialog(false)}>
          <div className="bg-bg-secondary border border-border rounded-lg p-4 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium text-text-primary mb-3">Save Query</div>
            <input
              autoFocus
              value={saveQueryName}
              onChange={(e) => setSaveQueryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveCurrentQuery(); if (e.key === 'Escape') setShowSaveDialog(false); }}
              placeholder="Query name..."
              className="w-full bg-bg-primary border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setShowSaveDialog(false)}
                className="px-3 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary transition-colors">
                Cancel
              </button>
              <button onClick={saveCurrentQuery} disabled={!saveQueryName.trim()}
                className="px-3 py-1 text-xs rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-50 transition-colors">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

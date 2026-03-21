import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { sql, MSSQL, PostgreSQL, type SQLNamespace } from '@codemirror/lang-sql';
import { bracketMatching } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { search, highlightSelectionMatches } from '@codemirror/search';
import { defaultKeymap, history as cmHistory, historyKeymap } from '@codemirror/commands';
import { dbAnalyserEditorTheme, dbAnalyserHighlighting } from '../code/codemirrorTheme';
import { QueryResultsGrid } from './QueryResultsGrid';
import { useStore } from '../../hooks/useStore';
import { api } from '../../api/client';
import type { QueryResponse, QueryHistoryEntry, DatabaseSchema } from '../../api/types';

const MAX_ROWS_OPTIONS = [100, 500, 1000, 5000, 10000];
const HISTORY_KEY = 'dbanalyser-query-history';
const MAX_HISTORY = 50;

// Compartment for dynamically updating the SQL schema without recreating the editor
const sqlCompartment = new Compartment();

function loadHistory(): QueryHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: QueryHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}

/** Build CodeMirror SQLNamespace from analysis schema data, filtered to a specific database.
 *  Produces: { "dbo": { "Customers": ["Id", "Name", ...], "Orders": [...] }, ... }
 */
function buildSqlSchema(schema: DatabaseSchema | null | undefined, database?: string): SQLNamespace {
  if (!schema) return {};

  const matchesDb = (objDb?: string) =>
    !database || !objDb || objDb.toLowerCase() === database.toLowerCase();

  const ns: Record<string, Record<string, string[]>> = {};

  for (const table of schema.tables) {
    if (!matchesDb(table.databaseName)) continue;
    const schemaName = table.schemaName || 'dbo';
    if (!ns[schemaName]) ns[schemaName] = {};
    ns[schemaName][table.tableName] = table.columns.map((c) => c.name);
  }

  for (const view of schema.views) {
    if (!matchesDb(view.databaseName)) continue;
    const schemaName = view.schemaName || 'dbo';
    if (!ns[schemaName]) ns[schemaName] = {};
    ns[schemaName][view.viewName] = view.columns.map((c) => c.name);
  }

  for (const proc of schema.storedProcedures) {
    if (!matchesDb(proc.databaseName)) continue;
    const schemaName = proc.schemaName || 'dbo';
    if (!ns[schemaName]) ns[schemaName] = {};
    ns[schemaName][proc.procedureName] = [];
  }

  for (const func of schema.functions) {
    if (!matchesDb(func.databaseName)) continue;
    const schemaName = func.schemaName || 'dbo';
    if (!ns[schemaName]) ns[schemaName] = {};
    ns[schemaName][func.functionName] = [];
  }

  return ns;
}

export function QueryPage() {
  const sessionId = useStore((s) => s.sessionId);
  const isFileSession = useStore((s) => s.isFileSession);
  const providerType = useStore((s) => s.providerType);
  const schema = useStore((s) => s.result?.schema);

  const [maxRows, setMaxRows] = useState(1000);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [history, setHistory] = useState<QueryHistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');

  const abortRef = useRef<AbortController | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Fetch available databases on mount
  useEffect(() => {
    if (!sessionId || isFileSession) return;
    api.getQueryDatabases(sessionId).then(({ databases: dbs, currentDatabase }) => {
      setDatabases(dbs);
      setSelectedDb(currentDatabase ?? '');
    }).catch(() => { /* ignore — non-server mode may have no databases */ });
  }, [sessionId, isFileSession]);

  const executeQuery = useCallback(async (sqlOverride?: string) => {
    if (!sessionId || isFileSession) return;

    const view = viewRef.current;
    if (!view) return;

    // Use selection if any, otherwise full content
    const selection = view.state.selection.main;
    const sqlText = sqlOverride ??
      (selection.from !== selection.to
        ? view.state.sliceDoc(selection.from, selection.to)
        : view.state.doc.toString());

    if (!sqlText.trim()) return;

    // Cancel any in-flight query
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsExecuting(true);
    setResponse(null);
    setActiveTab(0);

    try {
      const result = await api.executeQuery(sessionId, sqlText, maxRows, 30, selectedDb || undefined, controller.signal);
      setResponse(result);

      // Add to history
      const totalRows = result.resultSets.reduce((sum, rs) => sum + rs.totalRowsReturned, 0);
      const entry: QueryHistoryEntry = {
        sql: sqlText.length > 500 ? sqlText.slice(0, 500) + '...' : sqlText,
        executedAt: new Date().toISOString(),
        elapsedMs: result.elapsedMs,
        rowCount: totalRows,
        error: result.error,
      };
      setHistory((prev) => {
        const next = [entry, ...prev].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResponse({
        resultSets: [],
        elapsedMs: 0,
        error: err instanceof Error ? err.message : 'Query failed',
      });
    } finally {
      setIsExecuting(false);
      abortRef.current = null;
    }
  }, [sessionId, isFileSession, maxRows, selectedDb]);

  const cancelQuery = useCallback(() => {
    abortRef.current?.abort();
    setIsExecuting(false);
  }, []);

  // Build SQL schema for autocompletion, filtered to the selected database
  const sqlSchema = useMemo(() => buildSqlSchema(schema, selectedDb), [schema, selectedDb]);
  const sqlDialect = providerType === 'postgresql' ? PostgreSQL : MSSQL;

  // Core extensions (stable — only recreated if dialect changes)
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

  // Create editor
  useEffect(() => {
    if (!editorContainerRef.current) return;

    const state = EditorState.create({
      doc: '-- Write your SQL query here\n',
      extensions,
    });

    const view = new EditorView({ state, parent: editorContainerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions]);

  // Dynamically update schema when analysis results change (without recreating editor)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: sqlCompartment.reconfigure(sql({ dialect: sqlDialect, schema: sqlSchema })),
    });
  }, [sqlSchema, sqlDialect]);

  // Ctrl+Enter keybinding (on the container, since CodeMirror captures keys)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        executeQuery();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [executeQuery]);

  const restoreFromHistory = useCallback((entry: QueryHistoryEntry) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: entry.sql },
    });
    setShowHistory(false);
  }, []);

  if (isFileSession) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        Query execution is not available in file-session mode.
      </div>
    );
  }

  const totalRows = response?.resultSets.reduce((sum, rs) => sum + rs.totalRowsReturned, 0) ?? 0;
  const anyTruncated = response?.resultSets.some((rs) => rs.truncated) ?? false;
  const hasSchema = !!schema;

  return (
    <div className="flex flex-col h-full">
      {/* Warning banner */}
      <div className="bg-amber-900/30 border-b border-amber-700/50 px-4 py-1.5 text-xs text-amber-300 flex items-center gap-2">
        <span>&#9888;</span>
        <span>Queries execute directly against the database. Use caution with UPDATE, DELETE, and DROP statements.</span>
      </div>

      {/* Editor section */}
      <div className="flex-shrink-0 border-b border-border" style={{ height: '40%', minHeight: 120 }}>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border">
          <button
            onClick={() => executeQuery()}
            disabled={isExecuting}
            className="px-3 py-1 text-xs font-medium rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {isExecuting ? (
              <>
                <span className="animate-spin">&#9696;</span> Running...
              </>
            ) : (
              <>&#9655; Execute</>
            )}
          </button>

          {isExecuting && (
            <button
              onClick={cancelQuery}
              className="px-3 py-1 text-xs font-medium rounded border border-severity-error text-severity-error hover:bg-severity-error/10 transition-colors"
            >
              Cancel
            </button>
          )}

          <label className="flex items-center gap-1.5 text-xs text-text-secondary ml-2">
            Max rows:
            <select
              value={maxRows}
              onChange={(e) => setMaxRows(Number(e.target.value))}
              className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary"
            >
              {MAX_ROWS_OPTIONS.map((n) => (
                <option key={n} value={n}>{n.toLocaleString()}</option>
              ))}
            </select>
          </label>

          {databases.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-text-secondary ml-2">
              Database:
              <select
                value={selectedDb}
                onChange={(e) => setSelectedDb(e.target.value)}
                className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary max-w-[180px]"
              >
                {databases.map((db) => (
                  <option key={db} value={db}>{db}</option>
                ))}
              </select>
            </label>
          )}

          <div className="relative ml-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              disabled={history.length === 0}
              className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 transition-colors"
            >
              History ({history.length})
            </button>

            {showHistory && history.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-96 max-h-64 overflow-y-auto bg-bg-secondary border border-border rounded shadow-lg z-50">
                {history.map((entry, i) => (
                  <button
                    key={i}
                    onClick={() => restoreFromHistory(entry)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover border-b border-border/50 transition-colors"
                  >
                    <div className="font-mono text-text-primary truncate">{entry.sql}</div>
                    <div className="text-text-muted mt-0.5">
                      {new Date(entry.executedAt).toLocaleString()} &middot; {entry.elapsedMs}ms
                      {entry.error ? (
                        <span className="text-severity-error"> &middot; Error</span>
                      ) : (
                        <> &middot; {entry.rowCount} rows</>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="ml-auto text-xs text-text-muted flex items-center gap-3">
            {hasSchema ? (
              <span className="text-green-400" title="Schema loaded — autocomplete active">&#10003; Intellisense</span>
            ) : (
              <span className="text-text-muted" title="Run the Schema analyzer to enable autocomplete">No schema — run Schema analyzer for intellisense</span>
            )}
            <span>Ctrl+Enter to execute</span>
          </span>
        </div>

        <div
          ref={editorContainerRef}
          className="h-[calc(100%-36px)] w-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
        />
      </div>

      {/* Results section */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Status bar */}
        {response && (
          <div className="flex items-center gap-3 px-3 py-1.5 bg-bg-secondary border-b border-border text-xs">
            {response.error ? (
              <span className="text-severity-error">Error: {response.error}</span>
            ) : (
              <>
                <span className="text-text-secondary">
                  {response.resultSets.length} result set{response.resultSets.length !== 1 ? 's' : ''} &middot;{' '}
                  {totalRows.toLocaleString()} row{totalRows !== 1 ? 's' : ''} &middot;{' '}
                  {response.elapsedMs}ms
                </span>
                {anyTruncated && (
                  <span className="text-amber-400">
                    &#9888; Results truncated at {maxRows.toLocaleString()} rows
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Result set tabs */}
        {response && !response.error && response.resultSets.length > 1 && (
          <div className="flex border-b border-border bg-bg-secondary px-2">
            {response.resultSets.map((rs, i) => (
              <button
                key={i}
                onClick={() => setActiveTab(i)}
                className={`px-3 py-1.5 text-xs transition-colors border-b-2 ${
                  activeTab === i
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                Result {i + 1} ({rs.totalRowsReturned} rows)
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-auto p-3">
          {!response && !isExecuting && (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Write a query and press Execute or Ctrl+Enter
            </div>
          )}

          {isExecuting && (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              <span className="animate-spin mr-2">&#9696;</span> Executing query...
            </div>
          )}

          {response && !response.error && response.resultSets.length > 0 && (
            <QueryResultsGrid resultSet={response.resultSets[activeTab]} />
          )}

          {response && response.error && (
            <div className="bg-severity-error/10 border border-severity-error/30 rounded p-4 text-sm text-severity-error">
              <div className="font-medium mb-1">Query Error</div>
              <pre className="whitespace-pre-wrap font-mono text-xs">{response.error}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

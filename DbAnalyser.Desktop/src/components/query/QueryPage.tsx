import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { sql, MSSQL, PostgreSQL, PLSQL } from '@codemirror/lang-sql';
import { bracketMatching } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { defaultKeymap, history as cmHistory, historyKeymap } from '@codemirror/commands';
import { format as formatSql } from 'sql-formatter';
import { lintGutter } from '@codemirror/lint';
import { sqlSemanticLinter } from './sqlLinter';
import { dbAnalyserEditorTheme, dbAnalyserHighlighting } from '../code/codemirrorTheme';
import { QueryResultsGrid } from './QueryResultsGrid';
import { QueryToolbar } from './QueryToolbar';
import { QueryExplorer } from './QueryExplorer';
import { ExecutionPlanView } from './ExecutionPlanView';
import { ColumnStats } from './ColumnStats';
import { QueryChart } from './QueryChart';
import { IoStatsView, hasIoStats } from './IoStatsView';
import { useStore } from '../../hooks/useStore';
import { api } from '../../api/client';
import type { QueryResponse, QueryHistoryEntry } from '../../api/types';
import {
  MAX_ROWS_OPTIONS, MAX_HISTORY, MIN_EDITOR_HEIGHT, MIN_RESULTS_HEIGHT,
  historyKey, savedQueriesKey, queryTabsKey,
  loadHistory, saveHistory, loadSavedQueries, saveSavedQueries,
  loadQueryTabs, saveQueryTabs,
  getStatementAtCursor, buildSqlSchema,
  type QueryTab, type SavedQuery, type ResultsView,
} from './queryHelpers';

const sqlCompartment = new Compartment();
const lintCompartment = new Compartment();

interface PinnedResult {
  id: string;
  sql: string;
  response: QueryResponse;
  pinnedAt: string;
}

let tabCounter = 1;

export function QueryPage() {
  const sessionId = useStore((s) => s.sessionId);
  const isFileSession = useStore((s) => s.isFileSession);
  const providerType = useStore((s) => s.providerType);
  const dbSchema = useStore((s) => s.result?.schema);
  const serverName = useStore((s) => s.serverName);
  const disconnect = useStore((s) => s.disconnect);
  const setAiPendingPrompt = useStore((s) => s.setAiPendingPrompt);
  const aiExplainEnabled = useStore((s) => s.aiExplainEnabled);
  const navigateTo = useNavigate();

  // Connection-scoped storage keys
  const hKey = useMemo(() => historyKey(serverName), [serverName]);
  const sqKey = useMemo(() => savedQueriesKey(serverName), [serverName]);
  const qtKey = useMemo(() => queryTabsKey(serverName), [serverName]);

  // Query tabs — restore from localStorage or create default
  const [tabs, setTabs] = useState<QueryTab[]>(() => {
    const saved = loadQueryTabs(queryTabsKey(serverName));
    return saved?.tabs ?? [{ id: 'tab-1', title: 'Query 1', sql: '-- Write your SQL query here\n' }];
  });
  const [activeTabId, setActiveTabId] = useState(() => {
    const saved = loadQueryTabs(queryTabsKey(serverName));
    return saved?.activeTabId ?? 'tab-1';
  });

  const [maxRows, setMaxRows] = useState(1000);
  const [timeoutSeconds, setTimeoutSeconds] = useState(30);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState(0);
  const [resultsView, setResultsView] = useState<ResultsView>('results');
  const [history, setHistory] = useState<QueryHistoryEntry[]>(() => loadHistory(hKey));
  const [showHistory, setShowHistory] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [editorHeightPct, setEditorHeightPct] = useState(35);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => loadSavedQueries(sqKey));
  const [showSaved, setShowSaved] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveQueryName, setSaveQueryName] = useState('');
  const [executionStartTime, setExecutionStartTime] = useState<number | null>(null);
  const [elapsedDisplay, setElapsedDisplay] = useState('');
  const [pinnedResults, setPinnedResults] = useState<PinnedResult[]>([]);
  const [transactionState, setTransactionState] = useState<'none' | 'active'>('none');
  const [sessionLost, setSessionLost] = useState(false);
  const [showExplorer, setShowExplorer] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [fontSize, setFontSize] = useState(() => {
    try { return parseInt(localStorage.getItem(`dbanalyser-font-size`) ?? '13'); } catch { return 13; }
  });

  const abortRef = useRef<AbortController | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Persist editor content when switching tabs
  const saveCurrentTabSql = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentSql = view.state.doc.toString();
    setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, sql: currentSql, database: selectedDb } : t));
  }, [activeTabId, selectedDb]);

  // Fetch available databases on mount
  useEffect(() => {
    if (!sessionId || isFileSession) return;
    api.getQueryDatabases(sessionId).then(({ databases: dbs, currentDatabase }) => {
      setDatabases(dbs);
      // Only set default db if the active tab doesn't have a saved database
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (activeTab?.database && dbs.includes(activeTab.database)) {
        setSelectedDb(activeTab.database);
      } else {
        setSelectedDb(currentDatabase ?? '');
      }
    }).catch(() => {});
  }, [sessionId, isFileSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload history & saved queries when connection changes
  useEffect(() => {
    setHistory(loadHistory(hKey));
    setSavedQueries(loadSavedQueries(sqKey));
  }, [hKey, sqKey]);

  // Save tabs to localStorage (immediate)
  const saveTabsNow = useCallback(() => {
    const view = viewRef.current;
    if (view) {
      const currentSql = view.state.doc.toString();
      const updatedTabs = tabs.map((t) => t.id === activeTabId ? { ...t, sql: currentSql } : t);
      saveQueryTabs(qtKey, updatedTabs, activeTabId);
    } else {
      saveQueryTabs(qtKey, tabs, activeTabId);
    }
  }, [tabs, activeTabId, qtKey]);

  // Auto-save query tabs (debounced)
  useEffect(() => {
    const timer = setTimeout(saveTabsNow, 500);
    return () => clearTimeout(timer);
  }, [saveTabsNow]);

  // Save on unmount via ref to avoid stale closures
  const saveTabsRef = useRef(saveTabsNow);
  saveTabsRef.current = saveTabsNow;
  useEffect(() => {
    return () => saveTabsRef.current();
  }, []);

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
      const result = await api.executeQuery(sessionId, sqlText, maxRows || undefined, timeoutSeconds, selectedDb || undefined, showPlan, showStats, controller.signal);
      setResponse(result);

      // Jump to error location if possible
      if (result.error) {
        const view = viewRef.current;
        if (view) {
          const doc = view.state.doc.toString();
          // Try explicit "Line N" from SQL Server
          const lm = result.error.match(/\bLine\s+(\d+)\b/i);
          if (lm) {
            const lineNum = Math.min(parseInt(lm[1]), view.state.doc.lines);
            const lineInfo = view.state.doc.line(lineNum);
            view.dispatch({ selection: { anchor: lineInfo.from }, scrollIntoView: true });
          } else {
            // Fallback: find the object name mentioned in the error
            const objMatch = result.error.match(/(?:Invalid object name|Invalid column name|Could not find)\s+'([^']+)'/i)
              ?? result.error.match(/object\s+'([^']+)'/i);
            if (objMatch) {
              const name = objMatch[1];
              const idx = doc.toLowerCase().indexOf(name.toLowerCase());
              if (idx >= 0) {
                view.dispatch({ selection: { anchor: idx, head: idx + name.length }, scrollIntoView: true });
              }
            }
          }
        }
      }

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
      const msg = err instanceof Error ? err.message : 'Query failed';
      if (msg.toLowerCase().includes('session not found') || msg.toLowerCase().includes('connect first')) {
        setResponse({ resultSets: [], elapsedMs: 0, error: 'Session expired. Please reconnect.' });
        setSessionLost(true);
      } else {
        setResponse({ resultSets: [], elapsedMs: 0, error: msg });
      }
    } finally {
      setIsExecuting(false);
      setExecutionStartTime(null);
      abortRef.current = null;
    }
  }, [sessionId, isFileSession, maxRows, timeoutSeconds, selectedDb, hKey]);

  const executeCurrentStatement = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const cursorPos = view.state.selection.main.head;
    const fullText = view.state.doc.toString();
    const statement = getStatementAtCursor(fullText, cursorPos);
    if (statement) executeQuery(statement);
  }, [executeQuery]);

  const cancelQuery = useCallback(() => { abortRef.current?.abort(); setIsExecuting(false); }, []);

  const insertTextAtCursor = useCallback((text: string, database?: string) => {
    const view = viewRef.current;
    if (!view) return;

    // Switch DB dropdown if a database is specified
    if (database && databases.includes(database) && database !== selectedDb) {
      setSelectedDb(database);
    }

    // Check if editor is empty (ignoring comments and whitespace)
    const content = view.state.doc.toString();
    const stripped = content.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!stripped) {
      // Replace entire content
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    } else {
      // Insert at cursor
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, to: pos, insert: text } });
    }
    view.focus();
  }, [databases, selectedDb]);

  const handleExplorerResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerWidth;
    const onMove = (ev: MouseEvent) => {
      setExplorerWidth(Math.max(150, Math.min(400, startWidth + ev.clientX - startX)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [explorerWidth]);
  const clearResults = useCallback(() => { setResponse(null); setActiveResultTab(0); }, []);

  const formatQuery = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentSql = view.state.doc.toString();
    if (!currentSql.trim()) return;
    try {
      const language = providerType === 'postgresql' ? 'postgresql' as const : providerType === 'oracle' ? 'plsql' as const : 'tsql' as const;
      const formatted = formatSql(currentSql, { language, tabWidth: 2, keywordCase: 'upper' });
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
    } catch {}
  }, [providerType]);

  // ── Tab management ──
  const addTab = useCallback(() => {
    saveCurrentTabSql();
    tabCounter++;
    const newTab: QueryTab = { id: `tab-${Date.now()}`, title: `Query ${tabCounter}`, sql: '', database: selectedDb };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setResponse(null);
  }, [saveCurrentTabSql, selectedDb]);

  const openInNewTab = useCallback((text: string, database?: string) => {
    saveCurrentTabSql();
    tabCounter++;
    const db = database && databases.includes(database) ? database : selectedDb;
    const newTab: QueryTab = { id: `tab-${Date.now()}`, title: `Query ${tabCounter}`, sql: text, database: db };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setResponse(null);
    if (db !== selectedDb) setSelectedDb(db);
  }, [saveCurrentTabSql, databases, selectedDb]);

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
    // Restore the target tab's database
    const targetTab = tabs.find((t) => t.id === id);
    if (targetTab?.database) setSelectedDb(targetTab.database);
  }, [activeTabId, saveCurrentTabSql, tabs]);

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
  const sqlDialect = providerType === 'postgresql' ? PostgreSQL : providerType === 'oracle' ? PLSQL : MSSQL;

  const extensions = useMemo(() => [
    lineNumbers(),
    highlightActiveLine(),
    bracketMatching(),
    closeBrackets(),
    cmHistory(),
    search({ top: true }),
    highlightSelectionMatches(),
    autocompletion({ defaultKeymap: true, activateOnTyping: true }),
    sqlCompartment.of(sql({ dialect: sqlDialect, schema: sqlSchema })),
    lintCompartment.of(sqlSemanticLinter(sqlSchema)),
    lintGutter(),
    dbAnalyserEditorTheme,
    dbAnalyserHighlighting,
    keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, ...completionKeymap]),
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
    view.dispatch({ effects: [
      sqlCompartment.reconfigure(sql({ dialect: sqlDialect, schema: sqlSchema })),
      lintCompartment.reconfigure(sqlSemanticLinter(sqlSchema)),
    ] });
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
  const hasPlan = !!response?.executionPlan || (!!response?.error && resultsView === 'plan');
  const hasIo = hasMessages && hasIoStats(response?.messages ?? []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Object Explorer */}
      {showExplorer && dbSchema && (
        <>
          <div style={{ width: explorerWidth, minWidth: explorerWidth }} className="flex-shrink-0">
            <QueryExplorer onInsertText={insertTextAtCursor} onOpenInNewTab={openInNewTab} />
          </div>
          <div
            onMouseDown={handleExplorerResize}
            className="w-1 cursor-col-resize bg-border hover:bg-accent/40 transition-colors flex-shrink-0"
          />
        </>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden" ref={splitContainerRef}>
      {/* Warning banner */}
      {sessionLost ? (
        <div className="bg-severity-error/20 border-b border-severity-error/50 px-4 py-2 text-xs text-severity-error flex items-center gap-3">
          <span>&#9888;</span>
          <span>Session expired. The connection to the database was lost.</span>
          <button
            onClick={disconnect}
            className="px-3 py-1 rounded border border-severity-error/50 hover:bg-severity-error/20 transition-colors font-medium"
          >
            Reconnect
          </button>
        </div>
      ) : (
        <div className="bg-amber-900/30 border-b border-amber-700/50 px-4 py-1.5 text-xs text-amber-300 flex items-center gap-2">
          <span>&#9888;</span>
          <span>Queries execute directly against the database. Use caution with UPDATE, DELETE, and DROP statements.</span>
        </div>
      )}

      {/* Editor section */}
      <div className="flex-none overflow-hidden" style={{ height: `${editorHeightPct}%`, minHeight: MIN_EDITOR_HEIGHT, maxHeight: `calc(100% - ${MIN_RESULTS_HEIGHT}px)` }}>
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
        <QueryToolbar
          isExecuting={isExecuting}
          providerType={providerType}
          maxRows={maxRows}
          timeoutSeconds={timeoutSeconds}
          selectedDb={selectedDb}
          databases={databases}
          savedQueries={savedQueries}
          history={history}
          showSaved={showSaved}
          showHistory={showHistory}
          hasSchema={hasSchema}
          transactionState={transactionState}
          onExecute={() => executeQuery()}
          onExecutePlan={() => executeQuery(undefined, true)}
          onExecuteIoStats={() => executeQuery(undefined, false, true)}
          onCancel={cancelQuery}
          onFormat={formatQuery}
          onSetMaxRows={setMaxRows}
          onSetTimeout={setTimeoutSeconds}
          onSetSelectedDb={setSelectedDb}
          onSave={() => setShowSaveDialog(true)}
          onToggleSaved={() => setShowSaved(!showSaved)}
          onLoadQuery={loadQuery}
          onDeleteSavedQuery={deleteSavedQuery}
          onToggleHistory={() => setShowHistory(!showHistory)}
          onRestoreHistory={restoreFromHistory}
          onBeginTransaction={beginTransaction}
          onCommitTransaction={commitTransaction}
          onRollbackTransaction={rollbackTransaction}
          onAiExplain={aiExplainEnabled ? () => {
            const view = viewRef.current;
            if (!view) return;
            const sqlText = view.state.doc.toString().slice(0, 3000);
            if (!sqlText.trim()) return;
            setAiPendingPrompt(`Explain this SQL query:\n\n\`\`\`sql\n${sqlText}\n\`\`\`\n\nWhat does it do? Are there any performance concerns or improvements?`);
            navigateTo('/ai');
          } : undefined}
          showExplorer={showExplorer}
          onToggleExplorer={() => setShowExplorer(!showExplorer)}
          fontSize={fontSize}
          onSetFontSize={(s) => { setFontSize(s); localStorage.setItem('dbanalyser-font-size', String(s)); }}
        />

        {/* Editor */}
        <div ref={editorContainerRef}
          className="h-[calc(100%-68px)] w-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto [&_.cm-content]:!text-[length:var(--editor-font-size)] [&_.cm-gutters]:!text-[length:var(--editor-font-size)]"
          style={{ '--editor-font-size': `${fontSize}px` } as React.CSSProperties} />
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
          <div className="flex items-center bg-bg-secondary border-b border-border text-xs overflow-x-auto scrollbar-none flex-shrink-0">
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
            {response.resultSets.length > 0 && !response.error && (
              <button onClick={() => setResultsView('chart')}
                className={`px-3 py-1.5 border-b-2 transition-colors ${resultsView === 'chart' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                Chart
              </button>
            )}
            {hasIo && (
              <button onClick={() => setResultsView('performance')}
                className={`px-3 py-1.5 border-b-2 transition-colors ${resultsView === 'performance' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                IO Stats
              </button>
            )}

            <div className="ml-auto px-3 py-1.5 flex items-center gap-3 flex-shrink-0 whitespace-nowrap">
              {response.error ? (
                <span className="text-severity-error">Error</span>
              ) : (
                <>
                  <span className="text-text-secondary">
                    {totalRows.toLocaleString()} row{totalRows !== 1 ? 's' : ''} &middot; {response.elapsedMs}ms
                  </span>
                  {anyTruncated && <span className="text-amber-400">&#9888; Truncated at {maxRows.toLocaleString()}</span>}
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
        <div className="flex-1 overflow-hidden p-3 flex flex-col min-h-0">
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
            response.error
              ? <div className="bg-severity-error/10 border border-severity-error/30 rounded p-4 text-sm text-severity-error">
                  <div className="font-medium mb-1">Execution Plan Error</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs">{response.error}</pre>
                </div>
              : <ExecutionPlanView planText={response.executionPlan ?? ''} providerType={providerType} />
          )}

          {response && resultsView === 'statistics' && !response.error && response.resultSets.length > 0 && (
            <ColumnStats resultSet={response.resultSets[activeResultTab]} />
          )}

          {response && resultsView === 'chart' && !response.error && response.resultSets.length > 0 && (
            <QueryChart resultSet={response.resultSets[activeResultTab]} />
          )}

          {response && resultsView === 'performance' && hasIo && (
            <IoStatsView messages={response.messages ?? []} />
          )}

          {response && response.error && resultsView === 'results' && (() => {
            const error = response.error!;
            // Parse line number from SQL Server error
            const lineMatch = error.match(/\bLine\s+(\d+)\b/i);
            // Fallback: find object name in error
            const objMatch = !lineMatch
              ? (error.match(/(?:Invalid object name|Invalid column name|Could not find)\s+'([^']+)'/i)
                ?? error.match(/object\s+'([^']+)'/i))
              : null;

            const goToError = () => {
              const view = viewRef.current;
              if (!view) return;
              if (lineMatch) {
                const lineInfo = view.state.doc.line(Math.min(parseInt(lineMatch[1]), view.state.doc.lines));
                view.dispatch({ selection: { anchor: lineInfo.from }, scrollIntoView: true });
              } else if (objMatch) {
                const idx = view.state.doc.toString().toLowerCase().indexOf(objMatch[1].toLowerCase());
                if (idx >= 0) view.dispatch({ selection: { anchor: idx, head: idx + objMatch[1].length }, scrollIntoView: true });
              }
              view.focus();
            };

            const hasLocation = !!lineMatch || !!objMatch;

            return (
              <div className="bg-severity-error/10 border border-severity-error/30 rounded p-4 text-sm text-severity-error">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">Query Error</span>
                  {hasLocation && (
                    <button
                      onClick={goToError}
                      className="px-1.5 py-0.5 text-xs rounded border border-severity-error/40 hover:bg-severity-error/20 transition-colors"
                      title="Jump to error location"
                    >
                      {lineMatch ? `Line ${lineMatch[1]}` : `Go to ${objMatch![1]}`}
                    </button>
                  )}
                </div>
                <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
              </div>
            );
          })()}

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
    </div>
  );
}

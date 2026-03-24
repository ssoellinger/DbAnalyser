import type { QueryHistoryEntry } from '../../api/types';
import type { SavedQuery } from './queryHelpers';
import { MAX_ROWS_OPTIONS } from './queryHelpers';

interface QueryToolbarProps {
  isExecuting: boolean;
  providerType: string;
  maxRows: number;
  timeoutSeconds: number;
  selectedDb: string;
  databases: string[];
  savedQueries: SavedQuery[];
  history: QueryHistoryEntry[];
  showSaved: boolean;
  showHistory: boolean;
  hasSchema: boolean;
  transactionState: 'none' | 'active';
  onExecute: () => void;
  onExecutePlan: () => void;
  onExecuteIoStats: () => void;
  onCancel: () => void;
  onFormat: () => void;
  onSetMaxRows: (n: number) => void;
  onSetTimeout: (n: number) => void;
  onSetSelectedDb: (db: string) => void;
  onSave: () => void;
  onToggleSaved: () => void;
  onLoadQuery: (q: SavedQuery) => void;
  onDeleteSavedQuery: (name: string) => void;
  onToggleHistory: () => void;
  onRestoreHistory: (entry: QueryHistoryEntry) => void;
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onRollbackTransaction: () => void;
  onAiExplain?: () => void;
  showExplorer?: boolean;
  onToggleExplorer?: () => void;
}

export function QueryToolbar({
  isExecuting, providerType, maxRows, timeoutSeconds, selectedDb, databases,
  savedQueries, history, showSaved, showHistory, hasSchema, transactionState,
  onExecute, onExecutePlan, onExecuteIoStats, onCancel, onFormat,
  onSetMaxRows, onSetTimeout, onSetSelectedDb,
  onSave, onToggleSaved, onLoadQuery, onDeleteSavedQuery,
  onToggleHistory, onRestoreHistory,
  onBeginTransaction, onCommitTransaction, onRollbackTransaction,
  onAiExplain, showExplorer, onToggleExplorer,
}: QueryToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border">
      {onToggleExplorer && (
        <button onClick={onToggleExplorer}
          className={`px-2 py-1 text-xs rounded border transition-colors ${showExplorer ? 'border-accent text-accent bg-accent/10' : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}
          title={showExplorer ? 'Hide Object Explorer' : 'Show Object Explorer'}>
          &#9776;
        </button>
      )}
      <button onClick={onExecute} disabled={isExecuting}
        className="px-3 py-1 text-xs font-medium rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-50 transition-colors flex items-center gap-1.5">
        {isExecuting ? <><span className="animate-spin">&#9696;</span> Running...</> : <>&#9655; Execute</>}
      </button>

      {isExecuting && (
        <button onClick={onCancel}
          className="px-3 py-1 text-xs font-medium rounded border border-severity-error text-severity-error hover:bg-severity-error/10 transition-colors">
          Cancel
        </button>
      )}

      {/* Transaction controls */}
      {transactionState === 'none' ? (
        <button onClick={onBeginTransaction} disabled={isExecuting}
          className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-50 transition-colors"
          title="Begin a new transaction">
          BEGIN
        </button>
      ) : (
        <>
          <button onClick={onCommitTransaction} disabled={isExecuting}
            className="px-2 py-1 text-xs rounded border border-green-600 text-green-400 hover:bg-green-600/10 disabled:opacity-50 transition-colors"
            title="Commit the active transaction">
            COMMIT
          </button>
          <button onClick={onRollbackTransaction} disabled={isExecuting}
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

      <button onClick={onExecutePlan} disabled={isExecuting}
        className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
        title="Show execution plan">
        Plan
      </button>

      {providerType !== 'postgresql' && (
        <button onClick={onExecuteIoStats} disabled={isExecuting}
          className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="Execute with STATISTICS IO (shows table read counts)">
          IO Stats
        </button>
      )}

      <button onClick={onFormat}
        className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
        title="Format SQL">
        Format
      </button>

      {onAiExplain && (
        <button onClick={onAiExplain}
          className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-accent hover:bg-bg-hover transition-colors"
          title="Send query to AI for explanation">
          AI Explain
        </button>
      )}

      <label className="flex items-center gap-1.5 text-xs text-text-secondary ml-1">
        Max:
        <select value={maxRows} onChange={(e) => onSetMaxRows(Number(e.target.value))}
          className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary">
          {MAX_ROWS_OPTIONS.map((n) => <option key={n} value={n}>{n === 0 ? 'All' : n.toLocaleString()}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-text-secondary">
        Timeout:
        <select value={timeoutSeconds} onChange={(e) => onSetTimeout(Number(e.target.value))}
          className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary">
          {[10, 30, 60, 120, 300, 0].map((n) => <option key={n} value={n}>{n === 0 ? 'None' : `${n}s`}</option>)}
        </select>
      </label>

      {databases.length > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-text-secondary ml-1">
          DB:
          <select value={selectedDb} onChange={(e) => onSetSelectedDb(e.target.value)}
            className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary max-w-[150px]">
            {databases.map((db) => <option key={db} value={db}>{db}</option>)}
          </select>
        </label>
      )}

      {/* Save / Load */}
      <div className="relative ml-1">
        <button onClick={onSave}
          className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="Save query (Ctrl+S)">
          Save
        </button>
      </div>
      <div className="relative">
        <button onClick={onToggleSaved} disabled={savedQueries.length === 0}
          className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 transition-colors">
          Load ({savedQueries.length})
        </button>
        {showSaved && savedQueries.length > 0 && (
          <div className="absolute top-full left-0 mt-1 w-80 max-h-64 overflow-y-auto bg-bg-secondary border border-border rounded shadow-lg z-50">
            {savedQueries.map((q) => (
              <div key={q.name} className="flex items-center px-3 py-2 text-xs hover:bg-bg-hover border-b border-border/50 transition-colors">
                <button onClick={() => onLoadQuery(q)} className="flex-1 text-left">
                  <div className="text-text-primary font-medium">{q.name}</div>
                  <div className="text-text-muted truncate mt-0.5 font-mono">{q.sql.slice(0, 80)}</div>
                </button>
                <button onClick={() => onDeleteSavedQuery(q.name)} className="ml-2 text-text-muted hover:text-severity-error text-[10px]">&#10005;</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <div className="relative">
        <button onClick={onToggleHistory} disabled={history.length === 0}
          className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 transition-colors">
          History
        </button>
        {showHistory && history.length > 0 && (
          <div className="absolute top-full right-0 mt-1 w-96 max-h-64 overflow-y-auto bg-bg-secondary border border-border rounded shadow-lg z-50">
            {history.map((entry, i) => (
              <button key={i} onClick={() => onRestoreHistory(entry)}
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
  );
}

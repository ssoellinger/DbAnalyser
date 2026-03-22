import type { SQLNamespace } from '@codemirror/lang-sql';
import type { QueryHistoryEntry, DatabaseSchema } from '../../api/types';

// ── Constants ──

export const MAX_ROWS_OPTIONS = [100, 500, 1000, 5000, 10000, 0];
export const MAX_HISTORY = 50;
export const MIN_EDITOR_HEIGHT = 80;
export const MIN_RESULTS_HEIGHT = 80;

// ── Types ──

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
}

export interface SavedQuery {
  name: string;
  sql: string;
  savedAt: string;
}

export type ResultsView = 'results' | 'messages' | 'plan' | 'statistics' | 'performance';

// ── Storage key helpers ──

const HISTORY_KEY_PREFIX = 'dbanalyser-query-history';
const SAVED_QUERIES_KEY_PREFIX = 'dbanalyser-saved-queries';

export function historyKey(server: string | null): string {
  const suffix = server ? `-${server.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
  return `${HISTORY_KEY_PREFIX}${suffix}`;
}

export function savedQueriesKey(server: string | null): string {
  const suffix = server ? `-${server.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
  return `${SAVED_QUERIES_KEY_PREFIX}${suffix}`;
}

// ── Persistence helpers ──

export function loadHistory(key: string): QueryHistoryEntry[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveHistory(key: string, entries: QueryHistoryEntry[]) {
  try { localStorage.setItem(key, JSON.stringify(entries.slice(0, MAX_HISTORY))); } catch {}
}

export function loadSavedQueries(key: string): SavedQuery[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveSavedQueries(key: string, queries: SavedQuery[]) {
  try { localStorage.setItem(key, JSON.stringify(queries)); } catch {}
}

// ── SQL statement splitting ──

/** Find the SQL statement at the cursor position, delimited by GO or semicolons. */
export function getStatementAtCursor(text: string, cursorPos: number): string {
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

  for (const part of parts) {
    if (cursorPos >= part.start && cursorPos <= part.end && part.text.trim()) {
      return part.text.trim();
    }
  }

  return text.trim();
}

// ── Schema builder for autocomplete ──

export function buildSqlSchema(schema: DatabaseSchema | null | undefined, database?: string): SQLNamespace {
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

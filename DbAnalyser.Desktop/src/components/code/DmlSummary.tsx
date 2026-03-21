import { useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { useCodeStore } from './useCodeStore';
import { generateTableDdl } from './tableDdlGenerator';
import { OBJECT_TYPE_COLORS } from '../../api/types';

interface DmlSummaryProps {
  definition: string;
  objectType: string;
  fullName: string;
}

type DmlOp = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'EXEC';

const OP_COLORS: Record<DmlOp, string> = {
  SELECT: '#4fc3f7',
  INSERT: '#4ecca3',
  UPDATE: '#f0a500',
  DELETE: '#e94560',
  EXEC: '#bb86fc',
};

interface DmlEntry {
  tableName: string;
  ops: Set<DmlOp>;
}

// Table reference pattern: supports 1, 2, or 3-part names (db.schema.name)
const TABLE_REF = '(\\[?[\\w]+\\]?(?:\\.\\[?[\\w]+\\]?){0,2})';

// Regex patterns for DML operations — match the keyword followed by a table reference
const DML_PATTERNS: { op: DmlOp; re: RegExp }[] = [
  // SELECT ... FROM table, JOIN table
  { op: 'SELECT', re: new RegExp(`\\bFROM\\s+${TABLE_REF}`, 'gi') },
  { op: 'SELECT', re: new RegExp(`\\bJOIN\\s+${TABLE_REF}`, 'gi') },
  // INSERT INTO table
  { op: 'INSERT', re: new RegExp(`\\bINSERT\\s+(?:INTO\\s+)?${TABLE_REF}`, 'gi') },
  // UPDATE table
  { op: 'UPDATE', re: new RegExp(`\\bUPDATE\\s+${TABLE_REF}`, 'gi') },
  // DELETE FROM table
  { op: 'DELETE', re: new RegExp(`\\bDELETE\\s+(?:FROM\\s+)?${TABLE_REF}`, 'gi') },
  // EXEC/EXECUTE proc
  { op: 'EXEC', re: new RegExp(`\\bEXEC(?:UTE)?\\s+${TABLE_REF}`, 'gi') },
];

// SQL keywords and noise words that shouldn't be treated as table names
const NOISE_WORDS = new Set([
  'set', 'as', 'begin', 'end', 'declare', 'if', 'else', 'while', 'return',
  'select', 'insert', 'update', 'delete', 'from', 'into', 'where', 'and',
  'or', 'not', 'null', 'is', 'in', 'on', 'top', 'distinct', 'with',
  'output', 'values', 'exec', 'execute', 'procedure', 'function', 'trigger',
  'table', 'view', 'index', 'constraint', 'primary', 'foreign', 'key',
  'create', 'alter', 'drop', 'go', 'use', 'print', 'raiserror', 'throw',
  'try', 'catch', 'transaction', 'commit', 'rollback', 'save', 'cursor',
  'open', 'close', 'fetch', 'next', 'prior', 'first', 'last', 'absolute',
  'relative', 'forward_only', 'scroll', 'dynamic', 'fast_forward', 'read_only',
  'nocount', 'xact_abort', 'ansi_nulls', 'quoted_identifier',
]);

function parseDmlOperations(definition: string): Map<string, DmlEntry> {
  const entries = new Map<string, DmlEntry>();

  // Strip comments to avoid false positives
  const cleaned = definition
    .replace(/--[^\n]*/g, '')           // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '');  // block comments

  for (const { op, re } of DML_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(cleaned)) !== null) {
      const raw = match[1].replace(/\[/g, '').replace(/\]/g, '').trim();
      if (!raw || raw.startsWith('@') || raw.startsWith('#')) continue;
      const lower = raw.toLowerCase();
      if (NOISE_WORDS.has(lower) || NOISE_WORDS.has(lower.split('.').pop() ?? '')) continue;

      const key = raw.toLowerCase();
      if (!entries.has(key)) {
        entries.set(key, { tableName: raw, ops: new Set() });
      }
      entries.get(key)!.ops.add(op);
    }
  }

  return entries;
}

export function DmlSummary({ definition, objectType, fullName }: DmlSummaryProps) {
  const result = useStore((s) => s.result);
  const openTab = useCodeStore((s) => s.openTab);

  const entries = useMemo(() => {
    if (objectType !== 'Procedure' && objectType !== 'Function') return [];
    const map = parseDmlOperations(definition);
    return Array.from(map.values()).sort((a, b) => a.tableName.localeCompare(b.tableName));
  }, [definition, objectType]);

  // Build a lookup to resolve table names to navigable objects
  const objectLookup = useMemo(() => {
    if (!result?.schema) return new Map<string, { objectType: string; fullName: string; label: string; definition: string }>();
    const schema = result.schema;
    const map = new Map<string, { objectType: string; fullName: string; label: string; definition: string }>();
    for (const t of schema.tables) {
      map.set(t.fullName.toLowerCase(), { objectType: 'Table', fullName: t.fullName, label: t.tableName, definition: generateTableDdl(t) });
      map.set(t.tableName.toLowerCase(), { objectType: 'Table', fullName: t.fullName, label: t.tableName, definition: generateTableDdl(t) });
    }
    for (const v of schema.views) {
      map.set(v.fullName.toLowerCase(), { objectType: 'View', fullName: v.fullName, label: v.viewName, definition: v.definition ?? '' });
      map.set(v.viewName.toLowerCase(), { objectType: 'View', fullName: v.fullName, label: v.viewName, definition: v.definition ?? '' });
    }
    for (const p of schema.storedProcedures) {
      map.set(p.fullName.toLowerCase(), { objectType: 'Procedure', fullName: p.fullName, label: p.procedureName, definition: p.definition ?? '' });
      map.set(p.procedureName.toLowerCase(), { objectType: 'Procedure', fullName: p.fullName, label: p.procedureName, definition: p.definition ?? '' });
    }
    for (const f of schema.functions) {
      map.set(f.fullName.toLowerCase(), { objectType: 'Function', fullName: f.fullName, label: f.functionName, definition: f.definition ?? '' });
      map.set(f.functionName.toLowerCase(), { objectType: 'Function', fullName: f.fullName, label: f.functionName, definition: f.definition ?? '' });
    }
    return map;
  }, [result?.schema]);

  if (entries.length === 0) return null;

  function handleClick(tableName: string) {
    const obj = objectLookup.get(tableName.toLowerCase());
    if (obj) {
      openTab(obj);
    }
  }

  const allOps: DmlOp[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXEC'];

  return (
    <div className="border-b border-border bg-bg-primary">
      <div className="flex items-start gap-3 px-3 py-1.5 overflow-x-auto scrollbar-none">
        <span className="text-[10px] text-text-muted flex-shrink-0 pt-0.5">DML:</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {entries.map((entry) => {
            const resolved = objectLookup.get(entry.tableName.toLowerCase());
            const isClickable = !!resolved;
            const displayName = resolved ? resolved.fullName : entry.tableName;

            return (
              <span key={entry.tableName} className="flex items-center gap-1 text-[10px]">
                {isClickable ? (
                  <button
                    onClick={() => handleClick(entry.tableName)}
                    className="text-text-primary hover:text-accent transition-colors font-medium"
                    title={resolved.fullName}
                  >
                    {displayName}
                  </button>
                ) : (
                  <span className="text-text-secondary font-medium" title={entry.tableName}>
                    {displayName}
                  </span>
                )}
                <span className="flex gap-0.5">
                  {allOps.filter((op) => entry.ops.has(op)).map((op) => (
                    <span
                      key={op}
                      className="px-1 py-px rounded text-[8px] font-bold"
                      style={{
                        backgroundColor: OP_COLORS[op] + '20',
                        color: OP_COLORS[op],
                      }}
                    >
                      {op === 'SELECT' ? 'S' : op === 'INSERT' ? 'I' : op === 'UPDATE' ? 'U' : op === 'DELETE' ? 'D' : 'E'}
                    </span>
                  ))}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

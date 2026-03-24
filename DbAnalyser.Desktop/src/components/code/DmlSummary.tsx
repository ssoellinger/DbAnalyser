import { useMemo } from 'react';
import { useStore } from '../../hooks/useStore';
import { buildObjectLookup } from './schemaLookup';

interface DmlSummaryProps {
  definition: string;
  objectType: string;
  fullName: string;
}

type DmlOp = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'EXEC' | 'CREATE';

const OP_COLORS: Record<DmlOp, string> = {
  SELECT: '#4fc3f7',
  INSERT: '#4ecca3',
  UPDATE: '#f0a500',
  DELETE: '#e94560',
  EXEC: '#bb86fc',
  CREATE: '#78909c',
};

interface DmlEntry {
  tableName: string;
  ops: Set<DmlOp>;
  isTemp: boolean;
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

// Temp table patterns
const TEMP_TABLE_RE = /\bCREATE\s+TABLE\s+(#{1,2}[\w]+)/gi;
const TEMP_REF = '(#{1,2}[\\w]+)';
const TEMP_DML_PATTERNS: { op: DmlOp; re: RegExp }[] = [
  { op: 'SELECT', re: new RegExp(`\\bFROM\\s+${TEMP_REF}`, 'gi') },
  { op: 'SELECT', re: new RegExp(`\\bJOIN\\s+${TEMP_REF}`, 'gi') },
  { op: 'INSERT', re: new RegExp(`\\bINSERT\\s+(?:INTO\\s+)?${TEMP_REF}`, 'gi') },
  { op: 'UPDATE', re: new RegExp(`\\bUPDATE\\s+${TEMP_REF}`, 'gi') },
  { op: 'DELETE', re: new RegExp(`\\bDELETE\\s+(?:FROM\\s+)?${TEMP_REF}`, 'gi') },
];

function parseDmlOperations(definition: string): Map<string, DmlEntry> {
  const entries = new Map<string, DmlEntry>();

  // Strip comments to avoid false positives
  const cleaned = definition
    .replace(/--[^\n]*/g, '')           // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '');  // block comments

  // Parse regular table references
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
        entries.set(key, { tableName: raw, ops: new Set(), isTemp: false });
      }
      entries.get(key)!.ops.add(op);
    }
  }

  // Parse temp table CREATE statements
  TEMP_TABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEMP_TABLE_RE.exec(cleaned)) !== null) {
    const name = match[1];
    const key = name.toLowerCase();
    if (!entries.has(key)) {
      entries.set(key, { tableName: name, ops: new Set(), isTemp: true });
    }
    entries.get(key)!.isTemp = true;
    entries.get(key)!.ops.add('CREATE');
  }

  // Parse temp table DML references
  for (const { op, re } of TEMP_DML_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const name = m[1];
      const key = name.toLowerCase();
      if (!entries.has(key)) {
        entries.set(key, { tableName: name, ops: new Set(), isTemp: true });
      }
      entries.get(key)!.isTemp = true;
      entries.get(key)!.ops.add(op);
    }
  }

  return entries;
}

export function DmlSummary({ definition, objectType, fullName }: DmlSummaryProps) {
  const result = useStore((s) => s.result);
  const openDetailPanel = useStore((s) => s.openDetailPanel);

  const { regularEntries, tempEntries } = useMemo(() => {
    if (objectType !== 'Procedure' && objectType !== 'Function') return { regularEntries: [], tempEntries: [] };
    const map = parseDmlOperations(definition);
    const all = Array.from(map.values());
    return {
      regularEntries: all.filter((e) => !e.isTemp).sort((a, b) => a.tableName.localeCompare(b.tableName)),
      tempEntries: all.filter((e) => e.isTemp).sort((a, b) => a.tableName.localeCompare(b.tableName)),
    };
  }, [definition, objectType]);

  // Build a lookup to resolve table names to navigable objects (case-insensitive via buildObjectLookup)
  const objectLookup = useMemo(() => buildObjectLookup(result?.schema ?? null), [result?.schema]);

  if (regularEntries.length === 0 && tempEntries.length === 0) return null;

  function handleClick(tableName: string) {
    const obj = objectLookup.get(tableName.toLowerCase());
    if (obj) {
      openDetailPanel(obj.fullName, obj.objectType);
    }
  }

  const allOps: DmlOp[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXEC'];
  const tempOps: DmlOp[] = ['CREATE', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  const opLabel = (op: DmlOp) =>
    op === 'SELECT' ? 'S' : op === 'INSERT' ? 'I' : op === 'UPDATE' ? 'U' : op === 'DELETE' ? 'D' : op === 'EXEC' ? 'E' : 'C';

  return (
    <div className="border-b border-border bg-bg-primary">
      <div className="flex items-start gap-3 px-3 py-1.5 overflow-x-auto scrollbar-none">
        <span className="text-[10px] text-text-muted flex-shrink-0 pt-0.5">DML:</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {regularEntries.map((entry) => {
            const resolved = objectLookup.get(entry.tableName.toLowerCase());
            const isClickable = !!resolved;
            const parts = entry.tableName.split('.');
            const isCrossDb = parts.length >= 3;
            const dbName = isCrossDb ? parts[0] : null;
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
                  <span className={`font-medium ${isCrossDb ? 'text-text-muted italic' : 'text-text-secondary'}`} title={entry.tableName}>
                    {displayName}
                  </span>
                )}
                {isCrossDb && (
                  <span className="px-1 py-px rounded text-[8px] font-bold" style={{ backgroundColor: '#ff6b6b20', color: '#ff6b6b' }}>
                    {dbName}
                  </span>
                )}
                <span className="flex gap-0.5">
                  {allOps.filter((op) => entry.ops.has(op)).map((op) => (
                    <span
                      key={op}
                      className="px-1 py-px rounded text-[8px] font-bold"
                      style={{ backgroundColor: OP_COLORS[op] + '20', color: OP_COLORS[op] }}
                    >
                      {opLabel(op)}
                    </span>
                  ))}
                </span>
              </span>
            );
          })}
          {tempEntries.length > 0 && regularEntries.length > 0 && (
            <span className="text-text-muted text-[10px]">|</span>
          )}
          {tempEntries.map((entry) => (
            <span key={entry.tableName} className="flex items-center gap-1 text-[10px]">
              <span className="text-text-muted font-mono italic" title={entry.tableName.startsWith('##') ? 'Global temp table' : 'Local temp table'}>
                {entry.tableName}
              </span>
              <span
                className="px-1 py-px rounded text-[8px] font-bold"
                style={{ backgroundColor: '#ff704320', color: '#ff7043' }}
              >
                {entry.tableName.startsWith('##') ? 'G-TMP' : 'TMP'}
              </span>
              <span className="flex gap-0.5">
                {tempOps.filter((op) => entry.ops.has(op)).map((op) => (
                  <span
                    key={op}
                    className="px-1 py-px rounded text-[8px] font-bold"
                    style={{ backgroundColor: OP_COLORS[op] + '20', color: OP_COLORS[op] }}
                  >
                    {opLabel(op)}
                  </span>
                ))}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

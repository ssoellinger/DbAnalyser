import { useMemo, useState } from 'react';

interface OutlinePanelProps {
  definition: string;
  objectType: string;
  onGoToLine: (line: number) => void;
}

interface OutlineSymbol {
  name: string;
  kind: string; // 'param', 'variable', 'temptable', 'cursor', 'cte', 'insert', 'update', 'delete', 'select-into', 'exec', 'if', 'while', 'try', 'begin-tran'
  line: number;
  icon: string;
  color: string;
}

const KIND_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  param:        { icon: '@', color: '#4fc3f7', label: 'Parameters' },
  variable:     { icon: '@', color: '#bb86fc', label: 'Variables' },
  temptable:    { icon: '#', color: '#e94560', label: 'Temp Tables' },
  cursor:       { icon: '⇢', color: '#ff7043', label: 'Cursors' },
  cte:          { icon: 'W', color: '#4ecca3', label: 'CTEs' },
  insert:       { icon: '⊕', color: '#4ecca3', label: 'INSERT' },
  update:       { icon: '⊘', color: '#f0a500', label: 'UPDATE' },
  delete:       { icon: '⊖', color: '#e94560', label: 'DELETE' },
  'select-into':{ icon: '⊞', color: '#4fc3f7', label: 'SELECT INTO' },
  exec:         { icon: '▸', color: '#bb86fc', label: 'EXEC' },
  'if':         { icon: '?', color: '#888', label: 'IF' },
  'while':      { icon: '↻', color: '#888', label: 'WHILE' },
  'try':        { icon: '!', color: '#f0a500', label: 'TRY/CATCH' },
  'begin-tran': { icon: 'T', color: '#ff7043', label: 'Transaction' },
};

// Pre-compiled regex patterns (module level — created once)
const RE_DECLARE = /^DECLARE\s+(@\w+)/i;
const RE_TEMP_TABLE = /CREATE\s+TABLE\s+(#\w+)/i;
const RE_CURSOR = /^DECLARE\s+(\w+)\s+CURSOR/i;
const RE_WITH = /^WITH\s+/i;
const RE_CTE = /^WITH\s+(\w+)\s+AS\s*\(/i;
const RE_CTE_CONT = /^,?\s*(\w+)\s+AS\s*\(/i;
const RE_INSERT = /^INSERT\s+(?:INTO\s+)?(\[?\w+\]?(?:\.\[?\w+\]?)?)/;
const RE_UPDATE = /^UPDATE\s+(\[?\w+\]?(?:\.\[?\w+\]?)?)/;
const RE_UPDATE_STATS = /^UPDATE\s+STATISTICS/i;
const RE_DELETE = /^DELETE\s+(?:FROM\s+)?(\[?\w+\]?(?:\.\[?\w+\]?)?)/;
const RE_SELECT = /\bSELECT\b/i;
const RE_INTO = /\bINTO\s+(#?\[?\w+\]?)/i;
const RE_INTO_FULL = /\bINTO\s+(#?\[?\w+\]?(?:\.\[?\w+\]?)?)/i;
const RE_EXEC = /^EXEC(?:UTE)?\s+(\[?\w+\]?(?:\.\[?\w+\]?)?)/i;
const RE_BEGIN_TRY = /^BEGIN\s+TRY\b/i;
const RE_BEGIN_TRAN = /^BEGIN\s+TRAN(SACTION)?\b/i;

function parseOutline(definition: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  const lines = definition.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();
    const lineNum = i + 1;

    const declareMatch = trimmed.match(RE_DECLARE);
    if (declareMatch) {
      const name = declareMatch[1];
      if (name.startsWith('@#') || name.startsWith('@__')) continue;
      symbols.push({ name, kind: name.toLowerCase().includes('cursor') ? 'cursor' : 'variable', line: lineNum, ...KIND_CONFIG.variable });
      continue;
    }

    const tempTableMatch = trimmed.match(RE_TEMP_TABLE);
    if (tempTableMatch) {
      symbols.push({ name: tempTableMatch[1], kind: 'temptable', line: lineNum, ...KIND_CONFIG.temptable });
      continue;
    }

    const cursorMatch = trimmed.match(RE_CURSOR);
    if (cursorMatch) {
      symbols.push({ name: cursorMatch[1], kind: 'cursor', line: lineNum, ...KIND_CONFIG.cursor });
      continue;
    }

    if (RE_WITH.test(trimmed)) {
      const cteMatch = trimmed.match(RE_CTE);
      if (cteMatch) {
        symbols.push({ name: cteMatch[1], kind: 'cte', line: lineNum, ...KIND_CONFIG.cte });
      }
      continue;
    }

    const cteContMatch = trimmed.match(RE_CTE_CONT);
    if (cteContMatch && symbols.length > 0 && symbols[symbols.length - 1].kind === 'cte') {
      symbols.push({ name: cteContMatch[1], kind: 'cte', line: lineNum, ...KIND_CONFIG.cte });
      continue;
    }

    const insertMatch = upper.match(RE_INSERT);
    if (insertMatch) {
      symbols.push({ name: `INSERT ${insertMatch[1]}`, kind: 'insert', line: lineNum, ...KIND_CONFIG.insert });
      continue;
    }

    const updateMatch = upper.match(RE_UPDATE);
    if (updateMatch && !RE_UPDATE_STATS.test(trimmed)) {
      symbols.push({ name: `UPDATE ${updateMatch[1]}`, kind: 'update', line: lineNum, ...KIND_CONFIG.update });
      continue;
    }

    const deleteMatch = upper.match(RE_DELETE);
    if (deleteMatch) {
      symbols.push({ name: `DELETE ${deleteMatch[1]}`, kind: 'delete', line: lineNum, ...KIND_CONFIG.delete });
      continue;
    }

    if (RE_SELECT.test(trimmed) && RE_INTO.test(trimmed)) {
      const intoMatch = trimmed.match(RE_INTO_FULL);
      if (intoMatch) {
        symbols.push({ name: `SELECT INTO ${intoMatch[1]}`, kind: 'select-into', line: lineNum, ...KIND_CONFIG['select-into'] });
        continue;
      }
    }

    const execMatch = trimmed.match(RE_EXEC);
    if (execMatch) {
      symbols.push({ name: `EXEC ${execMatch[1]}`, kind: 'exec', line: lineNum, ...KIND_CONFIG.exec });
      continue;
    }

    if (RE_BEGIN_TRY.test(trimmed)) {
      symbols.push({ name: 'BEGIN TRY', kind: 'try', line: lineNum, ...KIND_CONFIG.try });
      continue;
    }

    if (RE_BEGIN_TRAN.test(trimmed)) {
      symbols.push({ name: 'BEGIN TRANSACTION', kind: 'begin-tran', line: lineNum, ...KIND_CONFIG['begin-tran'] });
      continue;
    }
  }

  return symbols;
}

export function OutlinePanel({ definition, objectType, onGoToLine }: OutlinePanelProps) {
  const symbols = useMemo(() => parseOutline(definition), [definition]);
  const [collapsed, setCollapsed] = useState(false);

  // Group by kind — must be before any early return to satisfy hooks rules
  const grouped = useMemo(() => {
    const groups: Record<string, OutlineSymbol[]> = {};
    for (const sym of symbols) {
      if (!groups[sym.kind]) groups[sym.kind] = [];
      groups[sym.kind].push(sym);
    }
    return groups;
  }, [symbols]);

  if (symbols.length === 0) return null;

  const groupOrder = ['param', 'variable', 'temptable', 'cursor', 'cte', 'insert', 'update', 'delete', 'select-into', 'exec', 'try', 'begin-tran'];

  return (
    <div className="border-l border-border bg-bg-secondary flex flex-col h-full" style={{ width: 200, minWidth: 200 }}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-[10px] font-medium text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors"
      >
        <span>{collapsed ? '▸' : '▾'}</span>
        Outline ({symbols.length})
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto py-1">
          {groupOrder.filter((k) => grouped[k]).map((kind) => {
            const cfg = KIND_CONFIG[kind];
            const items = grouped[kind];
            return (
              <div key={kind}>
                <div className="px-3 py-0.5 text-[9px] text-text-muted uppercase tracking-wider">
                  {cfg.label}
                </div>
                {items.map((sym, i) => (
                  <button
                    key={`${sym.kind}-${i}`}
                    onClick={() => onGoToLine(sym.line)}
                    className="w-full flex items-center gap-1.5 px-3 py-0.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                    title={`Line ${sym.line}`}
                  >
                    <span style={{ color: sym.color }} className="text-[10px] w-3 text-center flex-shrink-0 font-bold">
                      {sym.icon}
                    </span>
                    <span className="truncate">{sym.name}</span>
                    <span className="ml-auto text-[9px] text-text-muted">{sym.line}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

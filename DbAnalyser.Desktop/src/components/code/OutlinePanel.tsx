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
  select:       { icon: '⊙', color: '#4fc3f7', label: 'SELECT' },
  insert:       { icon: '⊕', color: '#4ecca3', label: 'INSERT' },
  update:       { icon: '⊘', color: '#f0a500', label: 'UPDATE' },
  delete:       { icon: '⊖', color: '#e94560', label: 'DELETE' },
  merge:        { icon: '⊛', color: '#26a69a', label: 'MERGE' },
  truncate:     { icon: '⊗', color: '#e94560', label: 'TRUNCATE' },
  'select-into':{ icon: '⊞', color: '#4fc3f7', label: 'SELECT INTO' },
  exec:         { icon: '▸', color: '#bb86fc', label: 'EXEC' },
  'if':         { icon: '?', color: '#888', label: 'IF' },
  'while':      { icon: '↻', color: '#888', label: 'WHILE' },
  'return':     { icon: '↩', color: '#78909c', label: 'RETURN' },
  'throw':      { icon: '⚠', color: '#e94560', label: 'THROW/RAISERROR' },
  'try':        { icon: '!', color: '#f0a500', label: 'TRY/CATCH' },
  'begin-tran': { icon: 'T', color: '#ff7043', label: 'Transaction' },
  drop:         { icon: '✕', color: '#e94560', label: 'DROP' },
};

// Pre-compiled regex patterns (module level — created once)
const RE_DECLARE = /^DECLARE\s+(@\w+)/i;
const RE_TEMP_TABLE = /CREATE\s+TABLE\s+(#{1,2}\w+)/i;
const RE_DROP_TABLE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(#*\[?\w+\]?(?:\.\[?\w+\]?)?)/i;
const RE_CURSOR = /^DECLARE\s+(\w+)\s+CURSOR/i;
const RE_WITH = /^WITH\s+/i;
const RE_CTE = /^WITH\s+(\w+)\s+AS\s*\(/i;
const RE_CTE_CONT = /^,?\s*(\w+)\s+AS\s*\(/i;
const RE_INSERT = /^INSERT\s+(?:INTO\s+)?(#*\[?\w+\]?(?:\.\[?\w+\]?)?)/;
const RE_UPDATE = /^UPDATE\s+(#*\[?\w+\]?(?:\.\[?\w+\]?)?)/;
const RE_UPDATE_STATS = /^UPDATE\s+STATISTICS/i;
const RE_DELETE = /^DELETE\s+(?:FROM\s+)?(#*\[?\w+\]?(?:\.\[?\w+\]?)?)/;
const RE_SELECT = /\bSELECT\b/i;
const RE_INTO = /\bINTO\s+(#*\[?\w+\]?)/i;
const RE_INTO_FULL = /\bINTO\s+(#*\[?\w+\]?(?:\.\[?\w+\]?)?)/i;
const RE_SELECT_ANYWHERE = /\bSELECT\b/i;
const RE_MERGE = /^MERGE\s+(?:INTO\s+)?(#*\[?\w+\]?(?:\.\[?\w+\]?)?)/i;
const RE_TRUNCATE = /^TRUNCATE\s+TABLE\s+(#*\[?\w+\]?(?:\.\[?\w+\]?)?)/i;
const RE_EXEC = /^EXEC(?:UTE)?\s+(\[?\w+\]?(?:\.\[?\w+\]?)?)/i;
const RE_EXEC_DYNAMIC = /^EXEC(?:UTE)?\s*\(/i;
const RE_IF = /^IF\b\s+(.{1,60})/i;
const RE_WHILE = /^WHILE\b\s+(.{1,60})/i;
const RE_RETURN = /^RETURN\b(.*)/i;
const RE_THROW = /^THROW\b\s+(.*)/i;
const RE_RAISERROR = /^RAISERROR\s*\(/i;
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
      symbols.push({ name: `CREATE ${tempTableMatch[1]}`, kind: 'temptable', line: lineNum, ...KIND_CONFIG.temptable });
      continue;
    }

    const dropMatch = trimmed.match(RE_DROP_TABLE);
    if (dropMatch) {
      const name = dropMatch[1].replace(/\[/g, '').replace(/\]/g, '');
      symbols.push({ name: `DROP ${name}`, kind: 'drop', line: lineNum, ...KIND_CONFIG.drop });
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

    const mergeMatch = trimmed.match(RE_MERGE);
    if (mergeMatch) {
      const name = mergeMatch[1].replace(/\[/g, '').replace(/\]/g, '');
      symbols.push({ name: `MERGE ${name}`, kind: 'merge', line: lineNum, ...KIND_CONFIG.merge });
      continue;
    }

    const truncateMatch = trimmed.match(RE_TRUNCATE);
    if (truncateMatch) {
      const name = truncateMatch[1].replace(/\[/g, '').replace(/\]/g, '');
      symbols.push({ name: `TRUNCATE ${name}`, kind: 'truncate', line: lineNum, ...KIND_CONFIG.truncate });
      continue;
    }

    const execMatch = trimmed.match(RE_EXEC);
    if (execMatch) {
      symbols.push({ name: `EXEC ${execMatch[1]}`, kind: 'exec', line: lineNum, ...KIND_CONFIG.exec });
      continue;
    }

    if (RE_EXEC_DYNAMIC.test(trimmed)) {
      symbols.push({ name: 'EXEC (dynamic SQL)', kind: 'exec', line: lineNum, ...KIND_CONFIG.exec });
      continue;
    }

    if (RE_SELECT.test(trimmed) && RE_INTO.test(trimmed)) {
      const intoMatch = trimmed.match(RE_INTO_FULL);
      if (intoMatch) {
        symbols.push({ name: `SELECT INTO ${intoMatch[1]}`, kind: 'select-into', line: lineNum, ...KIND_CONFIG['select-into'] });
        continue;
      }
    }

    // SELECT — look ahead for FROM to get the table name
    if (RE_SELECT_ANYWHERE.test(trimmed) && !RE_INTO.test(trimmed)) {
      // Check if this is a variable assignment (SELECT @var = ...) at start of line
      const isAssignment = /^\s*SELECT\s+@\w+\s*=/i.test(trimmed);
      // Determine context for the label
      const isExists = /\bEXISTS\s*\(\s*SELECT/i.test(trimmed);
      const isSubquery = !isExists && !/^\s*SELECT\b/i.test(trimmed);
      // Look for FROM on this line or next few lines
      let fromTarget = '';
      const fromRe = /\bFROM\s+(#*\[?\w+\]?(?:\.\[?\w+\]?){0,2})/i;
      for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        const fromMatch = lines[j].match(fromRe);
        if (fromMatch) {
          fromTarget = fromMatch[1].replace(/\[/g, '').replace(/\]/g, '');
          break;
        }
      }
      if (fromTarget && !isAssignment && !isSubquery) {
        symbols.push({ name: `SELECT FROM ${fromTarget}`, kind: 'select', line: lineNum, ...KIND_CONFIG.select });
      } else if (fromTarget && isAssignment) {
        symbols.push({ name: `SELECT @... FROM ${fromTarget}`, kind: 'select', line: lineNum, ...KIND_CONFIG.select });
      } else if (fromTarget && isExists) {
        symbols.push({ name: `EXISTS ${fromTarget}`, kind: 'select', line: lineNum, ...KIND_CONFIG.select });
      }
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

    const ifMatch = trimmed.match(RE_IF);
    if (ifMatch && !RE_BEGIN_TRY.test(trimmed)) {
      const cond = ifMatch[1].replace(/\s+/g, ' ').trim();
      symbols.push({ name: `IF ${cond}`, kind: 'if', line: lineNum, ...KIND_CONFIG['if'] });
      continue;
    }

    const whileMatch = trimmed.match(RE_WHILE);
    if (whileMatch) {
      const cond = whileMatch[1].replace(/\s+/g, ' ').trim();
      symbols.push({ name: `WHILE ${cond}`, kind: 'while', line: lineNum, ...KIND_CONFIG['while'] });
      continue;
    }

    const returnMatch = trimmed.match(RE_RETURN);
    if (returnMatch) {
      const val = returnMatch[1].trim().replace(/;$/, '').trim();
      symbols.push({ name: val ? `RETURN ${val}` : 'RETURN', kind: 'return', line: lineNum, ...KIND_CONFIG['return'] });
      continue;
    }

    const throwMatch = trimmed.match(RE_THROW);
    if (throwMatch) {
      const msg = throwMatch[1].replace(/;$/, '').trim();
      symbols.push({ name: `THROW ${msg.substring(0, 50)}`, kind: 'throw', line: lineNum, ...KIND_CONFIG['throw'] });
      continue;
    }

    if (RE_RAISERROR.test(trimmed)) {
      symbols.push({ name: 'RAISERROR', kind: 'throw', line: lineNum, ...KIND_CONFIG['throw'] });
      continue;
    }
  }

  return symbols;
}

type OutlineMode = 'flow' | 'grouped';

const GROUP_ORDER = ['param', 'variable', 'temptable', 'cursor', 'cte', 'select', 'insert', 'update', 'delete', 'merge', 'truncate', 'select-into', 'exec', 'drop', 'if', 'while', 'return', 'throw', 'try', 'begin-tran'];

function SymbolButton({ sym, onGoToLine }: { sym: OutlineSymbol; onGoToLine: (line: number) => void }) {
  const cfg = KIND_CONFIG[sym.kind];
  return (
    <button
      onClick={() => onGoToLine(sym.line)}
      className="w-full flex items-center gap-1.5 px-3 py-0.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
      title={`${cfg?.label ?? sym.kind} — Line ${sym.line}`}
    >
      <span style={{ color: sym.color }} className="text-[10px] w-3 text-center flex-shrink-0 font-bold">
        {sym.icon}
      </span>
      <span className="truncate">{sym.name}</span>
      <span className="ml-auto text-[9px] text-text-muted">{sym.line}</span>
    </button>
  );
}

export function OutlinePanel({ definition, objectType, onGoToLine }: OutlinePanelProps) {
  const symbols = useMemo(() => parseOutline(definition), [definition]);
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<OutlineMode>('flow');

  const grouped = useMemo(() => {
    if (mode !== 'grouped') return null;
    const groups: Record<string, OutlineSymbol[]> = {};
    for (const sym of symbols) {
      if (!groups[sym.kind]) groups[sym.kind] = [];
      groups[sym.kind].push(sym);
    }
    return groups;
  }, [symbols, mode]);

  if (symbols.length === 0) return null;

  return (
    <div className="border-l border-border bg-bg-secondary flex flex-col h-full" style={{ width: 200, minWidth: 200 }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-[10px] font-medium text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors"
        >
          <span>{collapsed ? '▸' : '▾'}</span> Outline ({symbols.length})
        </button>
        {!collapsed && (
          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => setMode('flow')}
              className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                mode === 'flow' ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-secondary'
              }`}
              title="Code order"
            >
              Flow
            </button>
            <button
              onClick={() => setMode('grouped')}
              className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                mode === 'grouped' ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-secondary'
              }`}
              title="Group by type"
            >
              Type
            </button>
          </div>
        )}
      </div>

      {!collapsed && mode === 'flow' && (
        <div className="flex-1 overflow-y-auto py-1">
          {symbols.map((sym, i) => (
            <SymbolButton key={`${sym.kind}-${sym.line}-${i}`} sym={sym} onGoToLine={onGoToLine} />
          ))}
        </div>
      )}

      {!collapsed && mode === 'grouped' && grouped && (
        <div className="flex-1 overflow-y-auto py-1">
          {GROUP_ORDER.filter((k) => grouped[k]).map((kind) => {
            const cfg = KIND_CONFIG[kind];
            return (
              <div key={kind}>
                <div className="px-3 py-0.5 text-[9px] text-text-muted uppercase tracking-wider">
                  {cfg.label}
                </div>
                {grouped[kind].map((sym, i) => (
                  <SymbolButton key={`${sym.kind}-${sym.line}-${i}`} sym={sym} onGoToLine={onGoToLine} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

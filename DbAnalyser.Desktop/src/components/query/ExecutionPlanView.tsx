import { useMemo, useState } from 'react';

// ── Plan node types ──

interface PlanNode {
  operator: string;
  detail: string;
  cost: string | null;
  rows: string | null;
  executions: string | null;
  depth: number;
  children: PlanNode[];
  raw: string;
}

// ── SQL Server SHOWPLAN_TEXT parser ──

function parseSqlServerPlan(text: string): PlanNode[] {
  const lines = text.split('\n').filter((l) => l.trim());
  const roots: PlanNode[] = [];
  const stack: PlanNode[] = [];

  for (const line of lines) {
    // Skip separator lines and headers
    if (line.startsWith('StmtText') || line.startsWith('---') || !line.trim()) continue;

    // Detect indent level by counting leading spaces and pipe characters
    const stripped = line.replace(/^\s*\|--/, '').replace(/^\s*/, '');
    const indentMatch = line.match(/^(\s*)/);
    const pipeMatch = line.match(/^(\s*\|--)/);
    const depth = pipeMatch ? Math.floor(pipeMatch[1].length / 5) : 0;

    // Extract operator info
    const operatorMatch = stripped.match(
      /^([\w\s]+?)(?:\(([^)]*)\))?(?:\s*(?:ORDERED\s+)?(?:FORWARD|BACKWARD))?$/,
    );

    // Extract cost/rows from common patterns
    const costMatch = line.match(/EstimateRows\s*=\s*([\d.e+]+)/i);
    const ioMatch = line.match(/EstimateIO\s*=\s*([\d.e+]+)/i);
    const cpuMatch = line.match(/EstimateCPU\s*=\s*([\d.e+]+)/i);

    const node: PlanNode = {
      operator: operatorMatch ? operatorMatch[1].trim() : stripped.trim(),
      detail: operatorMatch && operatorMatch[2] ? operatorMatch[2] : '',
      cost: ioMatch && cpuMatch
        ? `IO: ${parseFloat(ioMatch[1]).toFixed(4)}, CPU: ${parseFloat(cpuMatch[1]).toFixed(4)}`
        : null,
      rows: costMatch ? costMatch[1] : null,
      executions: null,
      depth,
      children: [],
      raw: line,
    };

    // Build tree structure
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }

  return roots;
}

// ── PostgreSQL EXPLAIN parser ──

function parsePostgresPlan(text: string): PlanNode[] {
  const lines = text.split('\n').filter((l) => l.trim());
  const roots: PlanNode[] = [];
  const stack: PlanNode[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Calculate depth from leading spaces/arrows
    const leadingMatch = line.match(/^(\s*)(->)?\s*/);
    const indent = leadingMatch ? leadingMatch[1].length + (leadingMatch[2] ? 2 : 0) : 0;
    const depth = Math.floor(indent / 3);

    const content = line.replace(/^\s*->\s*/, '').trim();

    // Extract operator and details
    const opMatch = content.match(
      /^(.+?)\s+\(cost=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+width=(\d+)\)(?:\s+\(actual time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)\))?/,
    );

    let node: PlanNode;
    if (opMatch) {
      node = {
        operator: opMatch[1].trim(),
        detail: '',
        cost: `${parseFloat(opMatch[2]).toFixed(2)}..${parseFloat(opMatch[3]).toFixed(2)}`,
        rows: opMatch[8] ?? opMatch[4], // actual rows if available, otherwise estimated
        executions: opMatch[9] ?? null,
        depth,
        children: [],
        raw: line,
      };
    } else {
      // Detail lines (Filter:, Sort Key:, etc.)
      const detailMatch = content.match(/^(\w[\w\s]*?):\s*(.*)/);
      if (detailMatch && stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (parent.detail) parent.detail += ` | ${detailMatch[1]}: ${detailMatch[2]}`;
        else parent.detail = `${detailMatch[1]}: ${detailMatch[2]}`;
        continue;
      }
      node = {
        operator: content,
        detail: '',
        cost: null,
        rows: null,
        executions: null,
        depth,
        children: [],
        raw: line,
      };
    }

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }

  return roots;
}

// ── Operator type colors ──

function getOperatorColor(op: string): string {
  const lower = op.toLowerCase();
  if (lower.includes('scan') || lower.includes('seq scan')) return 'text-amber-400';
  if (lower.includes('seek') || lower.includes('index scan') || lower.includes('index only')) return 'text-green-400';
  if (lower.includes('join') || lower.includes('nested loop') || lower.includes('merge') || lower.includes('hash')) return 'text-blue-400';
  if (lower.includes('sort') || lower.includes('order')) return 'text-purple-400';
  if (lower.includes('aggregate') || lower.includes('group')) return 'text-pink-400';
  if (lower.includes('filter') || lower.includes('where')) return 'text-cyan-400';
  if (lower.includes('insert') || lower.includes('update') || lower.includes('delete')) return 'text-red-400';
  return 'text-text-primary';
}

function getOperatorIcon(op: string): string {
  const lower = op.toLowerCase();
  if (lower.includes('scan') || lower.includes('seq scan')) return '\u{1F50D}'; // magnifying glass - scan
  if (lower.includes('seek') || lower.includes('index scan') || lower.includes('index only')) return '\u{1F3AF}'; // target - seek
  if (lower.includes('join') || lower.includes('nested loop') || lower.includes('merge') || lower.includes('hash')) return '\u{1F517}'; // link
  if (lower.includes('sort') || lower.includes('order')) return '\u{2195}'; // up-down arrow
  if (lower.includes('aggregate') || lower.includes('group')) return '\u{03A3}'; // sigma
  if (lower.includes('filter')) return '\u{25C7}'; // diamond
  if (lower.includes('select')) return '\u{25B6}'; // play
  return '\u{25CF}'; // bullet
}

// ── Tree node renderer ──

function PlanTreeNode({ node, isLast = false }: { node: PlanNode; isLast?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isScan = node.operator.toLowerCase().includes('scan') && !node.operator.toLowerCase().includes('seek');

  return (
    <div className="select-text">
      <div
        className={`flex items-start gap-2 py-1 px-2 rounded hover:bg-bg-hover transition-colors group cursor-pointer ${isScan ? 'bg-amber-900/10' : ''}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {/* Expand/collapse */}
        <span className="w-4 text-center text-text-muted text-[10px] flex-shrink-0 mt-0.5">
          {hasChildren ? (expanded ? '\u25BC' : '\u25B6') : '\u00B7'}
        </span>

        {/* Icon */}
        <span className="text-xs flex-shrink-0 mt-0.5">{getOperatorIcon(node.operator)}</span>

        {/* Operator name */}
        <span className={`font-medium text-xs ${getOperatorColor(node.operator)}`}>
          {node.operator}
        </span>

        {/* Detail */}
        {node.detail && (
          <span className="text-xs text-text-muted truncate max-w-[300px]" title={node.detail}>
            {node.detail}
          </span>
        )}

        {/* Metrics */}
        <span className="ml-auto flex items-center gap-3 text-[10px] text-text-secondary flex-shrink-0">
          {node.rows && (
            <span title="Estimated rows">
              <span className="text-text-muted">rows:</span> {Number(node.rows).toLocaleString()}
            </span>
          )}
          {node.cost && (
            <span title="Cost">
              <span className="text-text-muted">cost:</span> {node.cost}
            </span>
          )}
          {node.executions && (
            <span title="Loops/executions">
              <span className="text-text-muted">loops:</span> {node.executions}
            </span>
          )}
        </span>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="ml-4 border-l border-border/40 pl-1">
          {node.children.map((child, i) => (
            <PlanTreeNode key={i} node={child} isLast={i === node.children.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──

interface ExecutionPlanViewProps {
  planText: string;
  providerType?: string;
}

export function ExecutionPlanView({ planText, providerType }: ExecutionPlanViewProps) {
  const [viewMode, setViewMode] = useState<'tree' | 'raw'>('tree');

  const nodes = useMemo(() => {
    if (!planText) return [];
    if (providerType === 'postgresql') return parsePostgresPlan(planText);
    return parseSqlServerPlan(planText);
  }, [planText, providerType]);

  // Collect all scan warnings
  const warnings = useMemo(() => {
    const warns: string[] = [];
    const walk = (n: PlanNode) => {
      const lower = n.operator.toLowerCase();
      if ((lower.includes('table scan') || lower.includes('clustered index scan') || lower === 'seq scan') && n.rows) {
        const rows = parseInt(n.rows);
        if (rows > 1000) warns.push(`${n.operator} on ${n.detail || 'table'} (~${rows.toLocaleString()} rows)`);
      }
      n.children.forEach(walk);
    };
    nodes.forEach(walk);
    return warns;
  }, [nodes]);

  if (!planText) {
    return <div className="text-text-muted text-sm">No execution plan available. Click "Plan" to generate one.</div>;
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setViewMode('tree')}
          className={`px-2 py-1 text-xs rounded border transition-colors ${viewMode === 'tree' ? 'border-accent text-accent bg-accent/10' : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}
        >
          Tree View
        </button>
        <button
          onClick={() => setViewMode('raw')}
          className={`px-2 py-1 text-xs rounded border transition-colors ${viewMode === 'raw' ? 'border-accent text-accent bg-accent/10' : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}
        >
          Raw Text
        </button>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-text-muted">
          <span><span className="text-green-400">seek</span></span>
          <span><span className="text-amber-400">scan</span></span>
          <span><span className="text-blue-400">join</span></span>
          <span><span className="text-purple-400">sort</span></span>
          <span><span className="text-pink-400">aggregate</span></span>
        </div>
      </div>

      {/* Scan warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded px-3 py-2 text-xs text-amber-300">
          <span className="font-medium">Performance:</span> {warnings.length} table scan{warnings.length > 1 ? 's' : ''} detected
          <ul className="mt-1 ml-4 list-disc text-amber-400/80">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Content */}
      {viewMode === 'tree' ? (
        <div className="rounded border border-border bg-bg-primary/50 p-2">
          {nodes.length > 0 ? (
            nodes.map((node, i) => <PlanTreeNode key={i} node={node} isLast={i === nodes.length - 1} />)
          ) : (
            <pre className="font-mono text-xs text-text-secondary whitespace-pre-wrap">{planText}</pre>
          )}
        </div>
      ) : (
        <pre className="font-mono text-xs text-text-secondary whitespace-pre-wrap rounded border border-border bg-bg-primary/50 p-3">
          {planText}
        </pre>
      )}
    </div>
  );
}

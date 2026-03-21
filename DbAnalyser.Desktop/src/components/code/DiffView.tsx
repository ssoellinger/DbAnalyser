import { useMemo } from 'react';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { CodeTab } from './useCodeStore';

interface DiffViewProps {
  left: CodeTab;
  right: CodeTab;
  onClose: () => void;
}

interface DiffLine {
  type: 'same' | 'added' | 'removed' | 'changed';
  leftNum: number | null;
  rightNum: number | null;
  leftText: string;
  rightText: string;
}

/**
 * Simple line-based diff using LCS (longest common subsequence).
 */
function computeDiff(leftText: string, rightText: string): DiffLine[] {
  const leftLines = leftText.split('\n');
  const rightLines = rightText.split('\n');
  const m = leftLines.length;
  const n = rightLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      stack.push({ type: 'same', leftNum: i, rightNum: j, leftText: leftLines[i - 1], rightText: rightLines[j - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', leftNum: null, rightNum: j, leftText: '', rightText: rightLines[j - 1] });
      j--;
    } else {
      stack.push({ type: 'removed', leftNum: i, rightNum: null, leftText: leftLines[i - 1], rightText: '' });
      i--;
    }
  }

  stack.reverse();
  return stack;
}

const TYPE_COLORS = {
  same: '',
  added: 'bg-green-500/10',
  removed: 'bg-red-500/10',
  changed: 'bg-yellow-500/10',
};

const LINE_COLORS = {
  same: 'text-text-secondary',
  added: 'text-green-400',
  removed: 'text-red-400',
  changed: 'text-yellow-400',
};

export function DiffView({ left, right, onClose }: DiffViewProps) {
  const diffLines = useMemo(() => computeDiff(left.definition, right.definition), [left.definition, right.definition]);

  const stats = useMemo(() => {
    let added = 0, removed = 0, same = 0;
    for (const line of diffLines) {
      if (line.type === 'added') added++;
      else if (line.type === 'removed') removed++;
      else same++;
    }
    return { added, removed, same };
  }, [diffLines]);

  const leftColor = OBJECT_TYPE_COLORS[left.objectType] ?? '#666';
  const rightColor = OBJECT_TYPE_COLORS[right.objectType] ?? '#666';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-bg-card flex-shrink-0">
        <span className="text-[11px] font-medium text-text-primary">Diff View</span>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: leftColor }} />
          <span className="text-text-secondary">{left.fullName}</span>
        </div>
        <span className="text-text-muted text-[10px]">vs</span>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: rightColor }} />
          <span className="text-text-secondary">{right.fullName}</span>
        </div>
        <span className="ml-auto flex items-center gap-3 text-[10px]">
          <span className="text-green-400">+{stats.added}</span>
          <span className="text-red-400">-{stats.removed}</span>
          <span className="text-text-muted">{stats.same} unchanged</span>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-sm transition-colors"
          >
            &times;
          </button>
        </span>
      </div>

      {/* Diff content — side by side */}
      <div className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed">
        <table className="w-full border-collapse">
          <tbody>
            {diffLines.map((line, i) => (
              <tr key={i} className={TYPE_COLORS[line.type]}>
                {/* Left side */}
                <td className="w-10 text-right pr-2 text-text-muted select-none border-r border-border/30 align-top">
                  {line.leftNum ?? ''}
                </td>
                <td className={`px-2 whitespace-pre align-top w-1/2 ${LINE_COLORS[line.type === 'removed' ? 'removed' : 'same']}`}>
                  {line.type === 'removed' && <span className="text-red-400/50 select-none">- </span>}
                  {line.leftText}
                </td>
                {/* Right side */}
                <td className="w-10 text-right pr-2 text-text-muted select-none border-l border-r border-border/30 align-top">
                  {line.rightNum ?? ''}
                </td>
                <td className={`px-2 whitespace-pre align-top w-1/2 ${LINE_COLORS[line.type === 'added' ? 'added' : 'same']}`}>
                  {line.type === 'added' && <span className="text-green-400/50 select-none">+ </span>}
                  {line.rightText}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

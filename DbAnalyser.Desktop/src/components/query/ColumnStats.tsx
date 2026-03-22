import { useMemo } from 'react';
import type { QueryResultSet } from '../../api/types';

interface ColumnStatsProps {
  resultSet: QueryResultSet;
}

interface ColumnStat {
  name: string;
  totalRows: number;
  nullCount: number;
  distinctCount: number;
  min: string | null;
  max: string | null;
  avg: string | null;
  dataType: 'number' | 'text' | 'boolean' | 'null';
}

function detectType(values: (string | number | boolean | null)[]): 'number' | 'text' | 'boolean' | 'null' {
  for (const v of values) {
    if (v === null) continue;
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number') return 'number';
    // Check if string looks numeric
    if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) continue;
    return 'text';
  }
  // All null or all numeric strings
  const hasNonNull = values.some((v) => v !== null);
  if (!hasNonNull) return 'null';
  return 'number';
}

function computeStats(resultSet: QueryResultSet): ColumnStat[] {
  const { columns, rows } = resultSet;

  return columns.map((col, colIdx) => {
    const values = rows.map((row) => row[colIdx]);
    const nonNull = values.filter((v) => v !== null);
    const nullCount = values.length - nonNull.length;
    const distinctSet = new Set(nonNull.map(String));
    const type = detectType(values);

    let min: string | null = null;
    let max: string | null = null;
    let avg: string | null = null;

    if (type === 'number' && nonNull.length > 0) {
      const nums = nonNull.map(Number).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        min = Math.min(...nums).toLocaleString(undefined, { maximumFractionDigits: 4 });
        max = Math.max(...nums).toLocaleString(undefined, { maximumFractionDigits: 4 });
        const sum = nums.reduce((a, b) => a + b, 0);
        avg = (sum / nums.length).toLocaleString(undefined, { maximumFractionDigits: 4 });
      }
    } else if (type === 'text' && nonNull.length > 0) {
      const sorted = nonNull.map(String).sort();
      min = sorted[0].length > 30 ? sorted[0].slice(0, 30) + '...' : sorted[0];
      max = sorted[sorted.length - 1].length > 30 ? sorted[sorted.length - 1].slice(0, 30) + '...' : sorted[sorted.length - 1];
    }

    return {
      name: col,
      totalRows: values.length,
      nullCount,
      distinctCount: distinctSet.size,
      min,
      max,
      avg,
      dataType: type,
    };
  });
}

export function ColumnStats({ resultSet }: ColumnStatsProps) {
  const stats = useMemo(() => computeStats(resultSet), [resultSet]);

  if (stats.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-bg-secondary">
            <th className="px-3 py-2 text-left text-text-secondary font-medium">Column</th>
            <th className="px-3 py-2 text-left text-text-secondary font-medium">Type</th>
            <th className="px-3 py-2 text-right text-text-secondary font-medium">Non-Null</th>
            <th className="px-3 py-2 text-right text-text-secondary font-medium">Null</th>
            <th className="px-3 py-2 text-right text-text-secondary font-medium">Null %</th>
            <th className="px-3 py-2 text-right text-text-secondary font-medium">Distinct</th>
            <th className="px-3 py-2 text-left text-text-secondary font-medium">Min</th>
            <th className="px-3 py-2 text-left text-text-secondary font-medium">Max</th>
            <th className="px-3 py-2 text-left text-text-secondary font-medium">Avg</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => {
            const nullPct = s.totalRows > 0 ? ((s.nullCount / s.totalRows) * 100) : 0;
            return (
              <tr key={s.name} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                <td className="px-3 py-1.5 font-medium text-text-primary font-mono">{s.name}</td>
                <td className="px-3 py-1.5 text-text-muted">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    s.dataType === 'number' ? 'bg-blue-900/30 text-blue-400' :
                    s.dataType === 'boolean' ? 'bg-purple-900/30 text-purple-400' :
                    s.dataType === 'null' ? 'bg-gray-900/30 text-gray-400' :
                    'bg-green-900/30 text-green-400'
                  }`}>
                    {s.dataType}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right text-text-primary">{(s.totalRows - s.nullCount).toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right text-text-primary">
                  {s.nullCount > 0 ? <span className="text-amber-400">{s.nullCount.toLocaleString()}</span> : '0'}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {nullPct > 0 ? (
                    <div className="flex items-center gap-1.5 justify-end">
                      <div className="w-12 h-1.5 bg-bg-primary rounded overflow-hidden">
                        <div className="h-full bg-amber-500/60 rounded" style={{ width: `${Math.min(nullPct, 100)}%` }} />
                      </div>
                      <span className="text-amber-400">{nullPct.toFixed(1)}%</span>
                    </div>
                  ) : (
                    <span className="text-text-muted">0%</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right text-text-primary">{s.distinctCount.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-text-primary font-mono text-[11px]">{s.min ?? <span className="text-text-muted">-</span>}</td>
                <td className="px-3 py-1.5 text-text-primary font-mono text-[11px]">{s.max ?? <span className="text-text-muted">-</span>}</td>
                <td className="px-3 py-1.5 text-text-primary font-mono text-[11px]">{s.avg ?? <span className="text-text-muted">-</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import { useMemo } from 'react';

interface IoStatsViewProps {
  messages: string[];
}

interface TableIoStat {
  table: string;
  scanCount: number;
  logicalReads: number;
  physicalReads: number;
  readAheadReads: number;
  lobLogicalReads: number;
  lobPhysicalReads: number;
  lobReadAheadReads: number;
}

// Parse SQL Server STATISTICS IO output
// Format: "Table 'TableName'. Scan count 1, logical reads 5, physical reads 0, ..."
function parseIoStats(messages: string[]): TableIoStat[] {
  const stats: TableIoStat[] = [];

  for (const msg of messages) {
    const tableMatch = msg.match(/Table '([^']+)'\.\s*(.*)/);
    if (!tableMatch) continue;

    const tableName = tableMatch[1];
    const rest = tableMatch[2];

    // Skip worktable/worktablequeue internal tables if they have 0 reads
    const scanCount = parseInt(rest.match(/Scan count (\d+)/)?.[1] ?? '0');
    const logicalReads = parseInt(rest.match(/logical reads (\d+)/)?.[1] ?? '0');
    const physicalReads = parseInt(rest.match(/physical reads (\d+)/)?.[1] ?? '0');
    const readAheadReads = parseInt(rest.match(/read-ahead reads (\d+)/)?.[1] ?? '0');
    const lobLogicalReads = parseInt(rest.match(/lob logical reads (\d+)/)?.[1] ?? '0');
    const lobPhysicalReads = parseInt(rest.match(/lob physical reads (\d+)/)?.[1] ?? '0');
    const lobReadAheadReads = parseInt(rest.match(/lob read-ahead reads (\d+)/)?.[1] ?? '0');

    // Skip internal tables with all zeros
    if (tableName.startsWith('Worktable') && logicalReads === 0 && physicalReads === 0) continue;

    stats.push({
      table: tableName,
      scanCount,
      logicalReads,
      physicalReads,
      readAheadReads,
      lobLogicalReads,
      lobPhysicalReads,
      lobReadAheadReads,
    });
  }

  return stats;
}

function Heatbar({ value, max, color }: { value: number; max: number; color: string }) {
  if (max === 0) return <span className="text-text-muted">0</span>;
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 bg-bg-primary rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span>{value.toLocaleString()}</span>
    </div>
  );
}

export function IoStatsView({ messages }: IoStatsViewProps) {
  const stats = useMemo(() => parseIoStats(messages), [messages]);

  const { maxLogical, maxPhysical, totalLogical, totalPhysical } = useMemo(() => ({
    maxLogical: Math.max(...stats.map((s) => s.logicalReads), 1),
    maxPhysical: Math.max(...stats.map((s) => s.physicalReads), 1),
    totalLogical: stats.reduce((sum, s) => sum + s.logicalReads, 0),
    totalPhysical: stats.reduce((sum, s) => sum + s.physicalReads, 0),
  }), [stats]);

  if (stats.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-text-secondary">
          <span className="font-medium text-text-primary">{stats.length}</span> table{stats.length !== 1 ? 's' : ''} accessed
        </span>
        <span className="text-text-secondary">
          Logical reads: <span className="font-medium text-blue-400">{totalLogical.toLocaleString()}</span>
        </span>
        {totalPhysical > 0 && (
          <span className="text-text-secondary">
            Physical reads: <span className="font-medium text-amber-400">{totalPhysical.toLocaleString()}</span>
          </span>
        )}
        {totalPhysical > 0 && (
          <span className="text-amber-300 text-[10px] bg-amber-900/20 px-2 py-0.5 rounded border border-amber-700/40">
            Physical reads indicate data not in cache
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-bg-secondary">
              <th className="px-3 py-2 text-left text-text-secondary font-medium">Table</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">Scans</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">Logical Reads</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">Physical Reads</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">Read-Ahead</th>
              {stats.some((s) => s.lobLogicalReads > 0) && (
                <th className="px-3 py-2 text-right text-text-secondary font-medium">LOB Reads</th>
              )}
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                <td className="px-3 py-1.5 font-mono font-medium text-text-primary">{s.table}</td>
                <td className="px-3 py-1.5 text-right text-text-primary">{s.scanCount}</td>
                <td className="px-3 py-1.5 text-right text-blue-400">
                  <Heatbar value={s.logicalReads} max={maxLogical} color="bg-blue-500/60" />
                </td>
                <td className="px-3 py-1.5 text-right">
                  {s.physicalReads > 0 ? (
                    <Heatbar value={s.physicalReads} max={maxPhysical} color="bg-amber-500/60" />
                  ) : (
                    <span className="text-text-muted">0</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right text-text-primary">
                  {s.readAheadReads > 0 ? s.readAheadReads.toLocaleString() : <span className="text-text-muted">0</span>}
                </td>
                {stats.some((st) => st.lobLogicalReads > 0) && (
                  <td className="px-3 py-1.5 text-right text-text-primary">
                    {s.lobLogicalReads > 0 ? s.lobLogicalReads.toLocaleString() : <span className="text-text-muted">0</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {stats.length > 1 && (
            <tfoot>
              <tr className="border-t border-border bg-bg-secondary">
                <td className="px-3 py-1.5 font-medium text-text-secondary">Total</td>
                <td className="px-3 py-1.5 text-right font-medium text-text-primary">
                  {stats.reduce((s, r) => s + r.scanCount, 0)}
                </td>
                <td className="px-3 py-1.5 text-right font-medium text-blue-400">{totalLogical.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right font-medium text-amber-400">
                  {totalPhysical > 0 ? totalPhysical.toLocaleString() : <span className="text-text-muted">0</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-medium text-text-primary">
                  {stats.reduce((s, r) => s + r.readAheadReads, 0).toLocaleString()}
                </td>
                {stats.some((s) => s.lobLogicalReads > 0) && (
                  <td className="px-3 py-1.5 text-right font-medium text-text-primary">
                    {stats.reduce((s, r) => s + r.lobLogicalReads, 0).toLocaleString()}
                  </td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** Check if messages contain STATISTICS IO data */
export function hasIoStats(messages: string[]): boolean {
  return messages.some((m) => m.match(/Table '([^']+)'\.\s*Scan count/));
}

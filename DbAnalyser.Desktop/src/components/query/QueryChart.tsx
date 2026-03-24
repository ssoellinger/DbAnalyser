import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { QueryResultSet } from '../../api/types';

interface QueryChartProps {
  resultSet: QueryResultSet;
}

type ChartType = 'bar' | 'line' | 'pie' | 'scatter';

const COLORS = ['#4fc3f7', '#4ecca3', '#f0a500', '#e94560', '#bb86fc', '#ff7043', '#42a5f5', '#26a69a'];

function isNumeric(values: (string | number | boolean | null)[]): boolean {
  let numCount = 0;
  let total = 0;
  for (const v of values) {
    if (v === null) continue;
    total++;
    if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)))) numCount++;
  }
  return total > 0 && numCount / total > 0.8;
}

export function QueryChart({ resultSet }: QueryChartProps) {
  const { columns, rows } = resultSet;

  // Detect column types
  const columnTypes = useMemo(() => {
    return columns.map((_, colIdx) => {
      const values = rows.map((row) => row[colIdx]);
      return isNumeric(values) ? 'numeric' : 'text';
    });
  }, [columns, rows]);

  const numericColumns = useMemo(() => columns.filter((_, i) => columnTypes[i] === 'numeric'), [columns, columnTypes]);
  const textColumns = useMemo(() => columns.filter((_, i) => columnTypes[i] === 'text'), [columns, columnTypes]);

  // State
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [xColumn, setXColumn] = useState(() => textColumns[0] ?? columns[0] ?? '');
  const [yColumns, setYColumns] = useState<string[]>(() => numericColumns.length > 0 ? [numericColumns[0]] : []);

  // Transform data for recharts
  const chartData = useMemo(() => {
    const xIdx = columns.indexOf(xColumn);
    if (xIdx === -1) return [];

    return rows
      .filter((row) => row[xIdx] !== null)
      .map((row) => {
        const entry: Record<string, unknown> = { [xColumn]: row[xIdx] };
        for (const yCol of yColumns) {
          const yIdx = columns.indexOf(yCol);
          if (yIdx === -1) continue;
          const val = row[yIdx];
          entry[yCol] = val === null ? 0 : typeof val === 'number' ? val : Number(val) || 0;
        }
        return entry;
      });
  }, [columns, rows, xColumn, yColumns]);

  // Pie data needs special format
  const pieData = useMemo(() => {
    if (chartType !== 'pie' || yColumns.length === 0) return [];
    const yCol = yColumns[0];
    return chartData.map((entry) => ({
      name: String(entry[xColumn] ?? ''),
      value: Number(entry[yCol] ?? 0),
    }));
  }, [chartType, chartData, xColumn, yColumns]);

  function toggleYColumn(col: string) {
    setYColumns((prev) => {
      if (prev.includes(col)) return prev.filter((c) => c !== col);
      return [...prev, col];
    });
  }

  if (columns.length < 2) {
    return <div className="flex items-center justify-center h-full text-text-muted text-sm">Need at least 2 columns to create a chart</div>;
  }

  if (numericColumns.length === 0) {
    return <div className="flex items-center justify-center h-full text-text-muted text-sm">No numeric columns found for chart values</div>;
  }

  const tooltipStyle = {
    contentStyle: { backgroundColor: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: '6px', fontSize: '12px' },
    labelStyle: { color: '#a0a0b0' },
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-shrink-0 flex-wrap">
        {/* Chart type */}
        <div className="flex items-center gap-1">
          {(['bar', 'line', 'pie', 'scatter'] as ChartType[]).map((type) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                chartType === type
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        {/* X axis */}
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          {chartType === 'pie' ? 'Label:' : 'X:'}
          <select
            value={xColumn}
            onChange={(e) => setXColumn(e.target.value)}
            className="bg-bg-primary border border-border rounded px-2 py-0.5 text-xs text-text-primary"
          >
            {columns.map((col) => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
        </label>

        {/* Y axis — multi-select for bar/line, single for pie */}
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span>{chartType === 'pie' ? 'Value:' : 'Y:'}</span>
          {chartType === 'pie' ? (
            <select
              value={yColumns[0] ?? ''}
              onChange={(e) => setYColumns([e.target.value])}
              className="bg-bg-primary border border-border rounded px-2 py-0.5 text-xs text-text-primary"
            >
              {numericColumns.map((col) => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-1">
              {numericColumns.map((col, i) => (
                <button
                  key={col}
                  onClick={() => toggleYColumn(col)}
                  className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                    yColumns.includes(col)
                      ? 'text-white border-transparent'
                      : 'border-border text-text-muted hover:text-text-secondary'
                  }`}
                  style={yColumns.includes(col) ? { backgroundColor: COLORS[i % COLORS.length] } : undefined}
                >
                  {col}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="text-[10px] text-text-muted ml-auto">{chartData.length} data points</span>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">No data to display</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' ? (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
                <XAxis dataKey={xColumn} tick={{ fontSize: 11, fill: '#a0a0b0' }} />
                <YAxis tick={{ fontSize: 11, fill: '#a0a0b0' }} />
                <Tooltip {...tooltipStyle} />
                {yColumns.length > 1 && <Legend wrapperStyle={{ fontSize: '11px' }} />}
                {yColumns.map((col, i) => (
                  <Bar key={col} dataKey={col} fill={COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            ) : chartType === 'line' ? (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
                <XAxis dataKey={xColumn} tick={{ fontSize: 11, fill: '#a0a0b0' }} />
                <YAxis tick={{ fontSize: 11, fill: '#a0a0b0' }} />
                <Tooltip {...tooltipStyle} />
                {yColumns.length > 1 && <Legend wrapperStyle={{ fontSize: '11px' }} />}
                {yColumns.map((col, i) => (
                  <Line key={col} type="monotone" dataKey={col} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                ))}
              </LineChart>
            ) : chartType === 'pie' ? (
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius="80%"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={{ stroke: '#a0a0b0' }}
                  fontSize={11}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
              </PieChart>
            ) : (
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
                <XAxis dataKey={xColumn} type="number" tick={{ fontSize: 11, fill: '#a0a0b0' }} name={xColumn} />
                <YAxis dataKey={yColumns[0] ?? ''} type="number" tick={{ fontSize: 11, fill: '#a0a0b0' }} name={yColumns[0] ?? ''} />
                <Tooltip {...tooltipStyle} />
                <Scatter data={chartData} fill={COLORS[0]} />
              </ScatterChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

import { useMemo } from 'react';

interface StatusBarProps {
  definition: string;
  objectType: string;
}

interface CodeStats {
  lines: number;
  characters: number;
  keywords: { name: string; count: number }[];
  complexity: 'low' | 'medium' | 'high';
  complexityScore: number;
}

const TRACKED_KEYWORDS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE',
  'JOIN', 'LEFT', 'CURSOR', 'EXEC',
  'IF', 'WHILE', 'TRY', 'GOTO',
  'DYNAMIC',
];

function analyzeCode(definition: string): CodeStats {
  const lines = definition.split('\n').length;
  const characters = definition.length;
  const upper = definition.toUpperCase();

  // Count keywords
  const keywords: { name: string; count: number }[] = [];
  for (const kw of TRACKED_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'gi');
    const matches = upper.match(re);
    if (matches && matches.length > 0) {
      keywords.push({ name: kw, count: matches.length });
    }
  }

  // Complexity heuristic
  let score = 0;
  score += lines > 200 ? 3 : lines > 100 ? 2 : lines > 50 ? 1 : 0;
  const joins = (upper.match(/\bJOIN\b/g) || []).length;
  score += joins > 5 ? 3 : joins > 2 ? 2 : joins > 0 ? 1 : 0;
  const cursors = (upper.match(/\bCURSOR\b/g) || []).length;
  score += cursors * 2;
  const ifs = (upper.match(/\bIF\b/g) || []).length;
  score += ifs > 5 ? 2 : ifs > 2 ? 1 : 0;
  const whiles = (upper.match(/\bWHILE\b/g) || []).length;
  score += whiles * 2;
  const dynamics = (upper.match(/\bEXEC\s*\(/g) || []).length + (upper.match(/\bsp_executesql\b/gi) || []).length;
  score += dynamics * 2;
  const gotos = (upper.match(/\bGOTO\b/g) || []).length;
  score += gotos * 3;
  const subqueries = (upper.match(/\(\s*SELECT\b/g) || []).length;
  score += subqueries > 3 ? 2 : subqueries > 0 ? 1 : 0;

  const complexity = score >= 8 ? 'high' : score >= 4 ? 'medium' : 'low';

  return { lines, characters, keywords, complexity, complexityScore: score };
}

const COMPLEXITY_COLORS = {
  low: '#4ecca3',
  medium: '#f0a500',
  high: '#e94560',
};

export function StatusBar({ definition, objectType }: StatusBarProps) {
  const stats = useMemo(() => analyzeCode(definition), [definition]);

  return (
    <div className="flex items-center gap-4 px-3 py-1 border-t border-border bg-bg-secondary text-[10px] text-text-muted flex-shrink-0">
      <span>{stats.lines} lines</span>
      <span>{stats.characters.toLocaleString()} chars</span>
      <span>{objectType}</span>

      {/* Keyword badges */}
      {stats.keywords.slice(0, 6).map((kw) => (
        <span key={kw.name} className="flex items-center gap-0.5">
          <span className="text-text-secondary">{kw.name}</span>
          <span className="text-text-muted">×{kw.count}</span>
        </span>
      ))}

      {/* Complexity */}
      <span className="ml-auto flex items-center gap-1">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: COMPLEXITY_COLORS[stats.complexity] }}
        />
        <span style={{ color: COMPLEXITY_COLORS[stats.complexity] }}>
          {stats.complexity} complexity
        </span>
      </span>
    </div>
  );
}

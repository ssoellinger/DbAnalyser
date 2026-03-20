import { useState, useMemo, useRef, useEffect, type JSX } from 'react';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { AnalyzerLoader } from '../shared/AnalyzerLoader';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { useCodeStore } from './useCodeStore';
import { generateTableDdl } from './tableDdlGenerator';
import { useNavigate } from 'react-router-dom';

interface SearchResult {
  objectType: string;
  fullName: string;
  label: string;
  definition: string;
  matchLines: { lineNum: number; text: string }[];
  totalMatches: number;
}

export function CodeSearchPage() {
  const { status, error, progress, refresh, cancel } = useAnalyzer('schema');

  return (
    <AnalyzerLoader
      status={status}
      error={error}
      progress={progress}
      onRefresh={refresh}
      onCancel={cancel}
      analyzerName="Schema"
    >
      <CodeSearchContent />
    </AnalyzerLoader>
  );
}

function CodeSearchContent() {
  const result = useStore((s) => s.result);
  const openTab = useCodeStore((s) => s.openTab);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [regexError, setRegexError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Build all searchable objects
  const allObjects = useMemo(() => {
    if (!result?.schema) return [];
    const schema = result.schema;
    const items: { objectType: string; fullName: string; label: string; definition: string }[] = [];

    for (const t of schema.tables) {
      items.push({ objectType: 'Table', fullName: t.fullName, label: t.tableName, definition: generateTableDdl(t) });
    }
    for (const v of schema.views) {
      items.push({ objectType: 'View', fullName: v.fullName, label: v.viewName, definition: v.definition ?? '' });
    }
    for (const p of schema.storedProcedures) {
      items.push({ objectType: 'Procedure', fullName: p.fullName, label: p.procedureName, definition: p.definition ?? '' });
    }
    for (const f of schema.functions) {
      items.push({ objectType: 'Function', fullName: f.fullName, label: f.functionName, definition: f.definition ?? '' });
    }
    for (const t of schema.triggers) {
      items.push({ objectType: 'Trigger', fullName: t.fullName, label: t.triggerName, definition: t.definition ?? '' });
    }

    return items;
  }, [result]);

  // Build regex or plain matcher
  const matcher = useMemo<{ regex: RegExp | null; error: string | null }>(() => {
    const q = query.trim();
    if (!q) return { regex: null, error: null };

    if (isRegex) {
      try {
        const flags = isCaseSensitive ? 'g' : 'gi';
        const re = new RegExp(q, flags);
        return { regex: re, error: null };
      } catch (e: any) {
        return { regex: null, error: e.message ?? 'Invalid regex' };
      }
    }

    // Plain text: escape for regex use
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = isCaseSensitive ? 'g' : 'gi';
    return { regex: new RegExp(escaped, flags), error: null };
  }, [query, isRegex, isCaseSensitive]);

  // Update error state
  useEffect(() => {
    setRegexError(matcher.error);
  }, [matcher.error]);

  // Search results
  const results = useMemo<SearchResult[]>(() => {
    if (!matcher.regex) return [];
    const re = matcher.regex;

    const matched: SearchResult[] = [];
    for (const obj of allObjects) {
      if (typeFilter.size > 0 && !typeFilter.has(obj.objectType)) continue;
      if (!obj.definition) continue;

      const lines = obj.definition.split('\n');
      const matchLines: { lineNum: number; text: string }[] = [];
      let totalMatches = 0;

      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        const lineMatches = lines[i].match(new RegExp(re.source, re.flags));
        if (lineMatches && lineMatches.length > 0) {
          matchLines.push({ lineNum: i + 1, text: lines[i] });
          totalMatches += lineMatches.length;
        }
      }

      if (matchLines.length > 0) {
        matched.push({
          ...obj,
          matchLines: matchLines.slice(0, 5),
          totalMatches,
        });
      }
    }

    matched.sort((a, b) => b.totalMatches - a.totalMatches);
    return matched;
  }, [allObjects, matcher.regex, typeFilter]);

  // Type counts for filter buttons
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.objectType] = (counts[r.objectType] ?? 0) + 1;
    }
    return counts;
  }, [results]);

  const totalMatches = useMemo(
    () => results.reduce((sum, r) => sum + r.totalMatches, 0),
    [results]
  );

  function toggleType(type: string) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function openInCode(item: SearchResult, lineNum?: number) {
    openTab({
      objectType: item.objectType,
      fullName: item.fullName,
      label: item.label,
      definition: item.definition,
      goToLine: lineNum,
    });
    navigate('/code');
  }

  function highlightCode(text: string): JSX.Element {
    if (!matcher.regex) return <>{text}</>;
    const parts: (string | JSX.Element)[] = [];
    const re = new RegExp(matcher.regex.source, matcher.regex.flags);
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      if (match[0].length === 0) { re.lastIndex++; continue; } // prevent infinite loop on zero-length match
      if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
      parts.push(
        <span key={key++} className="bg-accent/30 text-accent rounded px-0.5">
          {match[0]}
        </span>
      );
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < text.length) parts.push(text.slice(lastIdx));
    return <>{parts}</>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xl">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isRegex ? 'Search with regex pattern...' : 'Search across all SQL definitions...'}
              className={`w-full px-4 py-2.5 bg-bg-card border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 ${
                regexError ? 'border-severity-error' : 'border-border'
              }`}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-sm"
              >
                &times;
              </button>
            )}
          </div>

          {/* Search mode toggles */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsRegex(!isRegex)}
              className={`px-2 py-1.5 rounded text-[11px] font-mono transition-colors border ${
                isRegex
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'text-text-muted border-border hover:text-text-secondary hover:border-text-muted'
              }`}
              title="Use regular expressions"
            >
              .*
            </button>
            <button
              onClick={() => setIsCaseSensitive(!isCaseSensitive)}
              className={`px-2 py-1.5 rounded text-[11px] font-mono transition-colors border ${
                isCaseSensitive
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'text-text-muted border-border hover:text-text-secondary hover:border-text-muted'
              }`}
              title="Match case"
            >
              Aa
            </button>
          </div>

          {query && !regexError && (
            <span className="text-xs text-text-muted">
              {totalMatches} match{totalMatches !== 1 ? 'es' : ''} in {results.length} object{results.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Regex error */}
        {regexError && (
          <div className="text-xs text-severity-error">
            Invalid regex: {regexError}
          </div>
        )}

        {/* Type filter chips */}
        {query && !regexError && Object.keys(typeCounts).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-text-muted uppercase tracking-wider">Filter:</span>
            {Object.entries(typeCounts).map(([type, count]) => {
              const active = typeFilter.size === 0 || typeFilter.has(type);
              const color = OBJECT_TYPE_COLORS[type] ?? '#666';
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors ${
                    active
                      ? 'bg-bg-card text-text-primary border border-border'
                      : 'text-text-muted border border-transparent hover:border-border'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  {type} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!query.trim() && (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            <div className="text-center space-y-2">
              <div className="text-2xl">&#128270;</div>
              <p>Search across all stored procedures, functions, views, and triggers</p>
              <p className="text-[11px]">
                Toggle <span className="font-mono bg-bg-card px-1 rounded">.*</span> for regex
                and <span className="font-mono bg-bg-card px-1 rounded">Aa</span> for case-sensitive search
              </p>
            </div>
          </div>
        )}

        {query.trim() && !regexError && results.length === 0 && (
          <div className="flex items-center justify-center h-48 text-text-muted text-sm">
            No matches found for "{query}"
          </div>
        )}

        {results.map((item) => {
          const color = OBJECT_TYPE_COLORS[item.objectType] ?? '#666';
          return (
            <div key={item.fullName} className="border-b border-border/50">
              {/* Object header */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-secondary/50">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-sm font-medium text-text-primary">{item.fullName}</span>
                <span className="text-[10px] text-text-muted">{item.objectType}</span>
                <span className="text-[10px] text-text-muted ml-auto">
                  {item.totalMatches} match{item.totalMatches !== 1 ? 'es' : ''}
                </span>
                <button
                  onClick={() => openInCode(item)}
                  className="text-[10px] text-accent hover:text-accent-hover transition-colors"
                >
                  Open in Code &rarr;
                </button>
              </div>

              {/* Matching lines */}
              <div className="bg-bg-primary">
                {item.matchLines.map((ml, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 px-4 py-1 hover:bg-bg-hover/30 transition-colors cursor-pointer"
                    onClick={() => openInCode(item, ml.lineNum)}
                  >
                    <span className="text-[10px] text-text-muted w-8 text-right flex-shrink-0 pt-0.5 font-mono">
                      {ml.lineNum}
                    </span>
                    <span className="text-xs font-mono text-text-secondary truncate">
                      {highlightCode(ml.text.trim())}
                    </span>
                  </div>
                ))}
                {item.matchLines.length < item.totalMatches && (
                  <div className="px-4 py-1 text-[10px] text-text-muted">
                    ... and {item.totalMatches - item.matchLines.length} more match{item.totalMatches - item.matchLines.length !== 1 ? 'es' : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

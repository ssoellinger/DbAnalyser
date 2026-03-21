import { useMemo } from 'react';

interface ParameterBarProps {
  definition: string;
  objectType: string;
}

interface ParsedParam {
  name: string;
  type: string;
  direction: string; // '', 'OUTPUT', 'OUT'
  defaultValue?: string;
}

// Pre-compiled regex patterns
const RE_CREATE_OR_ALTER = /^(CREATE|ALTER)\s+(PROCEDURE|PROC|FUNCTION)\b/i;
const RE_HAS_PARAM = /@\w+/;
const RE_AS_STANDALONE = /^\bAS\b\s*$/i;
const RE_BEGIN = /^\bBEGIN\b/i;
const RE_PARAM = /(@\w+)\s+([\w]+(?:\([\w,\s]+\))?(?:\s*\((?:max|\d+(?:,\s*\d+)?)\))?)\s*(?:=\s*([^,\-\/]+?))?\s*(OUTPUT|OUT)?\s*[,]?\s*(?:--.*)?$/i;

function parseParameters(definition: string, objectType: string): ParsedParam[] {
  if (objectType !== 'Procedure' && objectType !== 'Function') return [];

  const lines = definition.split('\n');
  const params: ParsedParam[] = [];
  let inParamSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();

    if (RE_CREATE_OR_ALTER.test(trimmed)) {
      inParamSection = true;
      if (!RE_HAS_PARAM.test(trimmed)) continue;
    }

    if (inParamSection && RE_AS_STANDALONE.test(trimmed)) break;
    if (inParamSection && upper === 'AS') break;
    if (inParamSection && RE_BEGIN.test(trimmed)) break;

    if (!inParamSection) continue;

    const paramMatch = trimmed.match(RE_PARAM);

    if (paramMatch) {
      params.push({
        name: paramMatch[1],
        type: paramMatch[2].trim(),
        direction: paramMatch[4] ?? '',
        defaultValue: paramMatch[3]?.trim(),
      });
    }
  }

  return params;
}

export function ParameterBar({ definition, objectType }: ParameterBarProps) {
  const params = useMemo(() => parseParameters(definition, objectType), [definition, objectType]);

  if (params.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-bg-primary overflow-x-auto scrollbar-none">
      <span className="text-[10px] text-text-muted flex-shrink-0">Params:</span>
      {params.map((p, i) => (
        <span
          key={i}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-[10px] flex-shrink-0"
          title={`${p.name} ${p.type}${p.defaultValue ? ` = ${p.defaultValue}` : ''}${p.direction ? ` ${p.direction}` : ''}`}
        >
          <span className="text-accent font-medium">{p.name}</span>
          <span className="text-text-muted">{p.type}</span>
          {p.defaultValue && (
            <span className="text-node-function">= {p.defaultValue}</span>
          )}
          {p.direction && (
            <span className="text-node-trigger text-[9px] font-bold">{p.direction}</span>
          )}
        </span>
      ))}
    </div>
  );
}

import type { AnalysisResult, AnalyzerName, AnalyzerStatus } from '../api/types';

const MAX_CONTEXT_CHARS = 8_000;

interface BuildContextOptions {
  result: AnalysisResult;
  serverName: string | null;
  analyzerStatus: Record<AnalyzerName, AnalyzerStatus>;
}

/** Strip common schema prefixes like dbo. */
function strip(name: string): string {
  return name.replace(/^dbo\./, '');
}

export function buildAiContext({ result, serverName, analyzerStatus }: BuildContextOptions): string {
  const sections: string[] = [];

  const mode = result.isServerMode ? `Server: ${serverName}` : `DB: ${result.databaseName}`;
  sections.push(
    `You are an expert database analyst. Answer questions about database structure, quality, relationships, and usage. Be concise and actionable.\n` +
    `Only answer database/SQL/data-related questions. Politely decline unrelated questions.\n\n` +
    `[INFO] ${mode} | Analyzed: ${result.analyzedAt}` +
    (result.isServerMode && result.databases.length > 0
      ? ` | DBs: ${result.databases.join(',')}`
      : '')
  );

  let totalLen = sections[0].length;

  if (result.qualityIssues && result.qualityIssues.length > 0) {
    const s = formatQualityIssues(result.qualityIssues);
    if (totalLen + s.length < MAX_CONTEXT_CHARS) { sections.push(s); totalLen += s.length; }
  }

  if (result.relationships) {
    const s = formatRelationships(result.relationships);
    if (totalLen + s.length < MAX_CONTEXT_CHARS) { sections.push(s); totalLen += s.length; }
  }

  if (result.indexRecommendations && result.indexRecommendations.length > 0) {
    const s = formatIndexRecommendations(result.indexRecommendations);
    if (totalLen + s.length < MAX_CONTEXT_CHARS) { sections.push(s); totalLen += s.length; }
  }

  if (result.usageAnalysis) {
    const s = formatUsage(result.usageAnalysis);
    if (totalLen + s.length < MAX_CONTEXT_CHARS) { sections.push(s); totalLen += s.length; }
  }

  if (result.schema) {
    const remaining = MAX_CONTEXT_CHARS - totalLen;
    if (remaining > 200) {
      sections.push(formatSchema(result.schema, remaining));
    }
  }

  const notRun = (Object.entries(analyzerStatus) as [AnalyzerName, AnalyzerStatus][])
    .filter(([, s]) => s === 'idle')
    .map(([name]) => name);
  if (notRun.length > 0) {
    sections.push(`[NOTE] Not run: ${notRun.join(',')}`);
  }

  return sections.join('\n');
}

function formatQualityIssues(issues: AnalysisResult['qualityIssues']): string {
  if (!issues || issues.length === 0) return '';
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');

  const lines = [`[QUALITY] ${errors.length}E ${warnings.length}W ${infos.length}I (${issues.length} total)`];

  for (const issue of [...errors, ...warnings].slice(0, 15)) {
    const sev = issue.severity === 'error' ? 'E' : 'W';
    lines.push(`${sev}|${strip(issue.objectName)}|${issue.description}`);
  }
  if (errors.length + warnings.length > 15) {
    lines.push(`+${errors.length + warnings.length - 15} more`);
  }
  return lines.join('\n');
}

function formatRelationships(rel: NonNullable<AnalysisResult['relationships']>): string {
  const lines: string[] = [];

  if (rel.explicitRelationships.length > 0) {
    lines.push(`[FK] ${rel.explicitRelationships.length} total`);
    for (const fk of rel.explicitRelationships.slice(0, 25)) {
      lines.push(`${strip(fk.fromTable)}.${fk.fromColumn}>${strip(fk.toTable)}.${fk.toColumn}`);
    }
    if (rel.explicitRelationships.length > 25) {
      lines.push(`+${rel.explicitRelationships.length - 25} more`);
    }
  }

  if (rel.implicitRelationships.length > 0) {
    lines.push(`[IMPL] ${rel.implicitRelationships.length} total`);
    for (const ir of rel.implicitRelationships.slice(0, 15)) {
      lines.push(`${strip(ir.fromTable)}.${ir.fromColumn}>${strip(ir.toTable)}.${ir.toColumn}|${ir.confidence}%|${ir.reason}`);
    }
    if (rel.implicitRelationships.length > 15) {
      lines.push(`+${rel.implicitRelationships.length - 15} more`);
    }
  }

  return lines.join('\n');
}

function formatIndexRecommendations(recs: NonNullable<AnalysisResult['indexRecommendations']>): string {
  const lines = [`[IDX] ${recs.length} total`];
  for (const r of recs.slice(0, 15)) {
    const sev = r.severity?.toUpperCase() ?? r.category;
    lines.push(`${sev}|${strip(r.tableName)}|${r.description}`);
  }
  if (recs.length > 15) lines.push(`+${recs.length - 15} more`);
  return lines.join('\n');
}

function formatUsage(usage: NonNullable<AnalysisResult['usageAnalysis']>): string {
  const lines: string[] = ['[USAGE]'];
  if (usage.serverUptimeDays != null) {
    lines[0] += ` uptime:${usage.serverUptimeDays}d`;
  }
  const unused = usage.objects.filter(o => o.usageLevel === 'unused');
  const low = usage.objects.filter(o => o.usageLevel === 'low');

  if (unused.length > 0) {
    lines.push(`Unused(${unused.length}):${unused.slice(0, 15).map(o => strip(o.objectName)).join(',')}${unused.length > 15 ? '...' : ''}`);
  }
  if (low.length > 0) {
    lines.push(`Low(${low.length}):${low.slice(0, 15).map(o => strip(o.objectName)).join(',')}${low.length > 15 ? '...' : ''}`);
  }
  return lines.join('\n');
}

function formatSchema(schema: NonNullable<AnalysisResult['schema']>, maxLen: number): string {
  const lines = [`[SCHEMA] T:${schema.tables.length} V:${schema.views.length} SP:${schema.storedProcedures.length} F:${schema.functions.length}`];

  let currentLen = lines[0].length;

  for (const table of schema.tables) {
    const cols = table.columns.map(c => {
      let s = `${c.name}:${c.dataType}`;
      if (c.isPrimaryKey) s += ':PK';
      if (!c.isNullable) s += ':NN';
      return s;
    }).join(',');

    const line = `${strip(table.fullName)}(${cols})`;

    if (currentLen + line.length + 2 > maxLen) {
      lines.push(`+${schema.tables.length - lines.length + 1} more tables`);
      break;
    }
    lines.push(line);
    currentLen += line.length + 1;
  }

  return lines.join('\n');
}

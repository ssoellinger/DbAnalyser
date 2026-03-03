import type { AnalysisResult, AnalyzerName, AnalyzerStatus } from '../api/types';

const MAX_CONTEXT_CHARS = 12_000;

interface BuildContextOptions {
  result: AnalysisResult;
  serverName: string | null;
  analyzerStatus: Record<AnalyzerName, AnalyzerStatus>;
}

export function buildAiContext({ result, serverName, analyzerStatus }: BuildContextOptions): string {
  const sections: string[] = [];

  // Header
  const mode = result.isServerMode ? `Server: ${serverName}` : `Database: ${result.databaseName}`;
  sections.push(
    `You are an expert database analyst. The user has analyzed a SQL Server database and you have access to the results below.\n` +
    `Answer questions about the database structure, quality, relationships, and usage. Be concise and actionable.\n\n` +
    `--- DATABASE INFO ---\n` +
    `${mode}\n` +
    `Analyzed at: ${result.analyzedAt}\n` +
    (result.isServerMode && result.databases.length > 0
      ? `Databases: ${result.databases.join(', ')}\n`
      : '')
  );

  let totalLen = sections[0].length;

  // Quality issues (high priority — these are what users care about most)
  if (result.qualityIssues && result.qualityIssues.length > 0) {
    const qSection = formatQualityIssues(result.qualityIssues);
    if (totalLen + qSection.length < MAX_CONTEXT_CHARS) {
      sections.push(qSection);
      totalLen += qSection.length;
    }
  }

  // Relationships
  if (result.relationships) {
    const rSection = formatRelationships(result.relationships);
    if (totalLen + rSection.length < MAX_CONTEXT_CHARS) {
      sections.push(rSection);
      totalLen += rSection.length;
    }
  }

  // Index recommendations
  if (result.indexRecommendations && result.indexRecommendations.length > 0) {
    const iSection = formatIndexRecommendations(result.indexRecommendations);
    if (totalLen + iSection.length < MAX_CONTEXT_CHARS) {
      sections.push(iSection);
      totalLen += iSection.length;
    }
  }

  // Usage analysis
  if (result.usageAnalysis) {
    const uSection = formatUsage(result.usageAnalysis);
    if (totalLen + uSection.length < MAX_CONTEXT_CHARS) {
      sections.push(uSection);
      totalLen += uSection.length;
    }
  }

  // Schema (fills remaining space)
  if (result.schema) {
    const remaining = MAX_CONTEXT_CHARS - totalLen;
    if (remaining > 200) {
      sections.push(formatSchema(result.schema, remaining));
    }
  }

  // Analyzer status note
  const notRun = (Object.entries(analyzerStatus) as [AnalyzerName, AnalyzerStatus][])
    .filter(([, s]) => s === 'idle')
    .map(([name]) => name);
  if (notRun.length > 0) {
    sections.push(`\nNote: The following analyzers have NOT been run yet: ${notRun.join(', ')}. Some information may be unavailable.`);
  }

  return sections.join('\n');
}

function formatQualityIssues(issues: AnalysisResult['qualityIssues']): string {
  if (!issues || issues.length === 0) return '';
  const lines = ['--- QUALITY ISSUES ---'];
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');

  lines.push(`Total: ${issues.length} (${errors.length} errors, ${warnings.length} warnings, ${infos.length} info)`);

  // Show errors first, then warnings (limit each group)
  for (const issue of [...errors, ...warnings].slice(0, 30)) {
    lines.push(`[${issue.severity.toUpperCase()}] ${issue.objectName}: ${issue.description}`);
    if (issue.recommendation) lines.push(`  -> ${issue.recommendation}`);
  }
  if (errors.length + warnings.length > 30) {
    lines.push(`... and ${errors.length + warnings.length - 30} more`);
  }
  return lines.join('\n');
}

function formatRelationships(rel: NonNullable<AnalysisResult['relationships']>): string {
  const lines = ['--- RELATIONSHIPS ---'];

  if (rel.explicitRelationships.length > 0) {
    lines.push(`Foreign Keys (${rel.explicitRelationships.length}):`);
    for (const fk of rel.explicitRelationships.slice(0, 40)) {
      lines.push(`  ${fk.fromTable}.${fk.fromColumn} -> ${fk.toTable}.${fk.toColumn}`);
    }
    if (rel.explicitRelationships.length > 40) {
      lines.push(`  ... and ${rel.explicitRelationships.length - 40} more`);
    }
  }

  if (rel.implicitRelationships.length > 0) {
    lines.push(`Implicit Relationships (${rel.implicitRelationships.length}):`);
    for (const ir of rel.implicitRelationships.slice(0, 20)) {
      lines.push(`  ${ir.fromTable}.${ir.fromColumn} -> ${ir.toTable}.${ir.toColumn} (confidence: ${ir.confidence}%, reason: ${ir.reason})`);
    }
    if (rel.implicitRelationships.length > 20) {
      lines.push(`  ... and ${rel.implicitRelationships.length - 20} more`);
    }
  }

  return lines.join('\n');
}

function formatIndexRecommendations(recs: NonNullable<AnalysisResult['indexRecommendations']>): string {
  const lines = ['--- INDEX RECOMMENDATIONS ---'];
  lines.push(`Total: ${recs.length}`);
  for (const r of recs.slice(0, 20)) {
    lines.push(`[${r.severity?.toUpperCase() ?? r.category}] ${r.tableName}: ${r.description}`);
    if (r.recommendation) lines.push(`  -> ${r.recommendation}`);
  }
  if (recs.length > 20) lines.push(`... and ${recs.length - 20} more`);
  return lines.join('\n');
}

function formatUsage(usage: NonNullable<AnalysisResult['usageAnalysis']>): string {
  const lines = ['--- USAGE ANALYSIS ---'];
  if (usage.serverUptimeDays != null) {
    lines.push(`Server uptime: ${usage.serverUptimeDays} days`);
  }
  const unused = usage.objects.filter(o => o.usageLevel === 'unused');
  const low = usage.objects.filter(o => o.usageLevel === 'low');

  if (unused.length > 0) {
    lines.push(`Unused objects (${unused.length}): ${unused.slice(0, 15).map(o => o.objectName).join(', ')}${unused.length > 15 ? '...' : ''}`);
  }
  if (low.length > 0) {
    lines.push(`Low-usage objects (${low.length}): ${low.slice(0, 15).map(o => o.objectName).join(', ')}${low.length > 15 ? '...' : ''}`);
  }
  return lines.join('\n');
}

function formatSchema(schema: NonNullable<AnalysisResult['schema']>, maxLen: number): string {
  const lines = ['--- SCHEMA ---'];
  lines.push(`Tables: ${schema.tables.length}, Views: ${schema.views.length}, Procedures: ${schema.storedProcedures.length}, Functions: ${schema.functions.length}`);

  let currentLen = lines.join('\n').length;

  for (const table of schema.tables) {
    const pks = table.columns.filter(c => c.isPrimaryKey).map(c => c.name);
    const colSummary = table.columns.map(c => {
      let s = `${c.name} ${c.dataType}`;
      if (c.isPrimaryKey) s += ' PK';
      if (!c.isNullable) s += ' NOT NULL';
      return s;
    }).join(', ');

    const line = `${table.fullName} (${pks.length > 0 ? 'PK: ' + pks.join(', ') + ' | ' : ''}${colSummary})`;

    if (currentLen + line.length + 2 > maxLen) {
      lines.push(`... and ${schema.tables.length - lines.length + 2} more tables (truncated)`);
      break;
    }
    lines.push(line);
    currentLen += line.length + 1;
  }

  return lines.join('\n');
}

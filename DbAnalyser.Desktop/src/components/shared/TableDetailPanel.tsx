import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../hooks/useStore';
import { useCodeStore } from '../code/useCodeStore';
import { generateTableDdl } from '../code/tableDdlGenerator';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { ColumnInfo, ForeignKeyInfo } from '../../api/types';

// ── Collapsible section ──

function Section({ title, count, defaultOpen = false, children }: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover/50 transition-colors"
      >
        <span className={`text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="font-medium">{title}</span>
        {count !== undefined && <span className="text-text-muted">({count})</span>}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

// ── Usage badge ──

const USAGE_COLORS: Record<string, string> = {
  active: '#4ecca3',
  low: '#f0a500',
  unused: '#e94560',
  unknown: '#78909c',
};

function UsageBadge({ level }: { level: string }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[9px] font-medium text-white"
      style={{ backgroundColor: USAGE_COLORS[level] ?? '#78909c' }}
    >
      {level}
    </span>
  );
}

// ── Column type formatter ──

function formatType(col: ColumnInfo): string {
  let type = col.dataType;
  if (col.maxLength && col.maxLength > 0 && ['varchar', 'nvarchar', 'char', 'nchar', 'varbinary'].includes(type.toLowerCase())) {
    type += col.maxLength === -1 ? '(MAX)' : `(${col.maxLength})`;
  } else if (col.precision && col.scale !== null && ['decimal', 'numeric'].includes(type.toLowerCase())) {
    type += `(${col.precision},${col.scale})`;
  }
  return type;
}

// ── Main component ──

export function TableDetailPanel() {
  const fullName = useStore((s) => s.detailPanelObject);
  const objectType = useStore((s) => s.detailPanelObjectType);
  const closePanel = useStore((s) => s.closeDetailPanel);
  const openPanel = useStore((s) => s.openDetailPanel);
  const result = useStore((s) => s.result);
  const openTab = useCodeStore((s) => s.openTab);
  const navigate = useNavigate();

  // Escape key
  useEffect(() => {
    if (!fullName) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullName, closePanel]);

  // ── Data aggregation ──

  const tableInfo = useMemo(() => {
    if (!fullName || !result?.schema) return null;
    if (objectType === 'View') {
      const view = result.schema.views.find((v) => v.fullName === fullName);
      if (!view) return null;
      return {
        kind: 'View' as const,
        fullName: view.fullName,
        name: view.viewName,
        schema: view.schemaName,
        database: view.databaseName,
        columns: view.columns,
        indexes: [] as typeof result.schema.tables[0]['indexes'],
        foreignKeys: [] as ForeignKeyInfo[],
        definition: view.definition ?? '',
      };
    }
    const table = result.schema.tables.find((t) => t.fullName === fullName);
    if (!table) return null;
    return {
      kind: 'Table' as const,
      fullName: table.fullName,
      name: table.tableName,
      schema: table.schemaName,
      database: table.databaseName,
      columns: table.columns,
      indexes: table.indexes,
      foreignKeys: table.foreignKeys,
      definition: generateTableDdl(table),
    };
  }, [fullName, objectType, result?.schema]);

  const profile = useMemo(() => {
    if (!fullName || !result?.profiles) return null;
    return result.profiles.find((p) => p.fullName === fullName) ?? null;
  }, [fullName, result?.profiles]);

  const qualityIssues = useMemo(() => {
    if (!fullName || !result?.qualityIssues) return [];
    return result.qualityIssues.filter((q) => q.objectName === fullName);
  }, [fullName, result?.qualityIssues]);

  const dependency = useMemo(() => {
    if (!fullName || !result?.relationships?.dependencies) return null;
    return result.relationships.dependencies.find((d) => d.fullName === fullName) ?? null;
  }, [fullName, result?.relationships?.dependencies]);

  const indexInventory = useMemo(() => {
    if (!fullName || !result?.indexInventory) return [];
    const parts = fullName.split('.');
    const schema = parts.length >= 2 ? parts[parts.length - 2] : '';
    const name = parts[parts.length - 1];
    return result.indexInventory.filter((idx) =>
      idx.schemaName === schema && idx.tableName === name
    );
  }, [fullName, result?.indexInventory]);

  const indexRecommendations = useMemo(() => {
    if (!fullName || !result?.indexRecommendations) return [];
    const parts = fullName.split('.');
    const schema = parts.length >= 2 ? parts[parts.length - 2] : '';
    const name = parts[parts.length - 1];
    return result.indexRecommendations.filter((r) =>
      r.schemaName === schema && r.tableName === name
    );
  }, [fullName, result?.indexRecommendations]);

  const usage = useMemo(() => {
    if (!fullName || !result?.usageAnalysis?.objects) return null;
    return result.usageAnalysis.objects.find((o) => o.objectName === fullName) ?? null;
  }, [fullName, result?.usageAnalysis]);

  // ── FK references (inbound) ──

  const inboundFks = useMemo(() => {
    if (!fullName || !result?.relationships?.explicitRelationships) return [];
    return result.relationships.explicitRelationships.filter((fk) => {
      const toFull = fk.toDatabase
        ? `${fk.toDatabase}.${fk.toSchema}.${fk.toTable}`
        : `${fk.toSchema}.${fk.toTable}`;
      return toFull === fullName;
    });
  }, [fullName, result?.relationships?.explicitRelationships]);

  // ── Navigation helpers ──

  const navigateToObject = useCallback((name: string) => {
    if (!result?.schema) return;
    const isTable = result.schema.tables.some((t) => t.fullName === name);
    const isView = result.schema.views.some((v) => v.fullName === name);
    if (isTable) openPanel(name, 'Table');
    else if (isView) openPanel(name, 'View');
  }, [result?.schema, openPanel]);

  const openInCode = useCallback(() => {
    if (!tableInfo) return;
    openTab({
      objectType: tableInfo.kind,
      fullName: tableInfo.fullName,
      label: tableInfo.name,
      definition: tableInfo.definition,
    });
    navigate('/code');
    closePanel();
  }, [tableInfo, openTab, navigate, closePanel]);

  // ── Render ──

  if (!fullName || !tableInfo) return null;

  const severityColors = { error: '#e94560', warning: '#f0a500', info: '#4fc3f7' };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={closePanel}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-[420px] bg-bg-primary border-l border-border shadow-2xl z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-secondary flex-shrink-0">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: OBJECT_TYPE_COLORS[tableInfo.kind] ?? '#666' }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text-primary truncate">{tableInfo.fullName}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-text-muted">{tableInfo.kind}</span>
              {profile && (
                <span className="text-[10px] text-text-secondary">{profile.rowCount.toLocaleString()} rows</span>
              )}
              {usage && <UsageBadge level={usage.usageLevel} />}
            </div>
          </div>
          <button
            onClick={closePanel}
            className="text-text-muted hover:text-text-primary text-lg transition-colors"
          >
            &times;
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Columns */}
          <Section title="Columns" count={tableInfo.columns.length} defaultOpen>
            <table className="w-full text-[11px]">
              <tbody>
                {tableInfo.columns.map((col) => {
                  const fkCols = new Set(tableInfo.foreignKeys.map((fk) => fk.fromColumn));
                  return (
                    <tr key={col.name} className="border-b border-border/30 hover:bg-bg-hover/30">
                      <td className="py-1 pr-2">
                        <span className="flex items-center gap-1">
                          {col.isPrimaryKey && <span className="text-[8px] px-0.5 rounded bg-accent/20 text-accent">PK</span>}
                          {fkCols.has(col.name) && <span className="text-[8px] px-0.5 rounded bg-node-view/20 text-node-view">FK</span>}
                          {col.isIdentity && <span className="text-[8px] px-0.5 rounded bg-purple-500/20 text-purple-400">ID</span>}
                          <span className={`${col.isPrimaryKey ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>
                            {col.name}
                          </span>
                        </span>
                      </td>
                      <td className="py-1 text-text-muted text-right">{formatType(col)}</td>
                      <td className="py-1 pl-2 text-center w-6">
                        {col.isNullable && <span className="text-text-muted text-[9px]">?</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          {/* Indexes */}
          {(tableInfo.indexes.length > 0 || indexInventory.length > 0) && (
            <Section title="Indexes" count={tableInfo.indexes.length || indexInventory.length}>
              <div className="space-y-2">
                {(indexInventory.length > 0 ? indexInventory : tableInfo.indexes).map((idx, i) => {
                  const inv = 'userSeeks' in idx ? idx : null;
                  return (
                    <div key={i} className="text-[11px]">
                      <div className="flex items-center gap-1">
                        {'isClustered' in idx && idx.isClustered && (
                          <span className="text-[8px] px-0.5 rounded bg-accent/20 text-accent">CL</span>
                        )}
                        {'isUnique' in idx && idx.isUnique && (
                          <span className="text-[8px] px-0.5 rounded bg-green-500/20 text-green-400">UQ</span>
                        )}
                        <span className="text-text-primary font-medium">{'indexName' in idx ? idx.indexName : idx.name}</span>
                      </div>
                      <div className="text-text-muted ml-4">
                        {'columns' in idx && (typeof idx.columns === 'string' ? idx.columns : idx.columns.join(', '))}
                      </div>
                      {inv && (
                        <div className="text-[10px] text-text-muted ml-4">
                          Seeks: {inv.userSeeks.toLocaleString()} | Scans: {inv.userScans.toLocaleString()} | Size: {(inv.sizeKB / 1024).toFixed(1)}MB
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Foreign Keys (outbound) */}
          {tableInfo.foreignKeys.length > 0 && (
            <Section title="Foreign Keys (outbound)" count={tableInfo.foreignKeys.length}>
              <div className="space-y-1.5">
                {tableInfo.foreignKeys.map((fk, i) => {
                  const toFull = fk.toDatabase
                    ? `${fk.toDatabase}.${fk.toSchema}.${fk.toTable}`
                    : `${fk.toSchema}.${fk.toTable}`;
                  return (
                    <div key={i} className="text-[11px]">
                      <span className="text-text-muted">{fk.fromColumn}</span>
                      <span className="text-text-muted mx-1">&rarr;</span>
                      <button
                        onClick={() => navigateToObject(toFull)}
                        className="text-accent hover:underline"
                      >
                        {toFull}.{fk.toColumn}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Foreign Keys (inbound) */}
          {inboundFks.length > 0 && (
            <Section title="Referenced By (inbound FK)" count={inboundFks.length}>
              <div className="space-y-1.5">
                {inboundFks.map((fk, i) => {
                  const fromFull = fk.fromDatabase
                    ? `${fk.fromDatabase}.${fk.fromSchema}.${fk.fromTable}`
                    : `${fk.fromSchema}.${fk.fromTable}`;
                  return (
                    <div key={i} className="text-[11px]">
                      <button
                        onClick={() => navigateToObject(fromFull)}
                        className="text-accent hover:underline"
                      >
                        {fromFull}
                      </button>
                      <span className="text-text-muted mx-1">.{fk.fromColumn} &rarr; {fk.toColumn}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Profile */}
          {profile && (
            <Section title="Data Profile" count={profile.columnProfiles.length}>
              <div className="text-[11px] mb-2">
                <span className="text-text-muted">Row count:</span>{' '}
                <span className="text-text-primary font-medium">{profile.rowCount.toLocaleString()}</span>
              </div>
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-text-muted">
                    <th className="text-left py-0.5">Column</th>
                    <th className="text-right py-0.5">Null%</th>
                    <th className="text-right py-0.5">Distinct</th>
                    <th className="text-right py-0.5">Min</th>
                    <th className="text-right py-0.5">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.columnProfiles.map((cp) => (
                    <tr key={cp.columnName} className="border-b border-border/20">
                      <td className="py-0.5 text-text-secondary">{cp.columnName}</td>
                      <td className="py-0.5 text-right">
                        {cp.nullPercentage > 0
                          ? <span className="text-amber-400">{cp.nullPercentage.toFixed(1)}%</span>
                          : <span className="text-text-muted">0%</span>}
                      </td>
                      <td className="py-0.5 text-right text-text-secondary">{cp.distinctCount.toLocaleString()}</td>
                      <td className="py-0.5 text-right text-text-muted truncate max-w-[60px]">{cp.minValue ?? '-'}</td>
                      <td className="py-0.5 text-right text-text-muted truncate max-w-[60px]">{cp.maxValue ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* Quality Issues */}
          {qualityIssues.length > 0 && (
            <Section title="Quality Issues" count={qualityIssues.length}>
              <div className="space-y-1.5">
                {qualityIssues.map((q, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span
                      className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0"
                      style={{ backgroundColor: severityColors[q.severity as keyof typeof severityColors] ?? '#666' }}
                    />
                    <div>
                      <div className="text-text-secondary">{q.description}</div>
                      {q.recommendation && (
                        <div className="text-text-muted text-[10px] mt-0.5">{q.recommendation}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Dependencies */}
          {dependency && (dependency.dependsOn.length > 0 || dependency.referencedBy.length > 0) && (
            <Section title="Dependencies" count={dependency.dependsOn.length + dependency.referencedBy.length}>
              {dependency.dependsOn.length > 0 && (
                <div className="mb-2">
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Depends on ({dependency.dependsOn.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {dependency.dependsOn.map((name) => (
                      <button
                        key={name}
                        onClick={() => navigateToObject(name)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-accent hover:border-accent/30 transition-colors"
                      >
                        {name.split('.').pop()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {dependency.referencedBy.length > 0 && (
                <div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Used by ({dependency.referencedBy.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {dependency.referencedBy.map((name) => (
                      <button
                        key={name}
                        onClick={() => navigateToObject(name)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-bg-card border border-border/50 text-accent hover:border-accent/30 transition-colors"
                      >
                        {name.split('.').pop()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {dependency.importanceScore > 0 && (
                <div className="mt-2 text-[10px] text-text-muted">
                  Importance: <span className="text-amber-400 font-medium">{dependency.importanceScore.toFixed(1)}</span>
                  {dependency.transitiveImpact?.length > 0 && (
                    <> | Impact: <span className="text-red-400 font-medium">{dependency.transitiveImpact.length} objects</span></>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* Index Recommendations */}
          {indexRecommendations.length > 0 && (
            <Section title="Index Recommendations" count={indexRecommendations.length}>
              <div className="space-y-2">
                {indexRecommendations.map((r, i) => (
                  <div key={i} className="text-[11px]">
                    <div className="text-text-secondary">{r.description}</div>
                    {r.recommendation && (
                      <div className="text-text-muted text-[10px] mt-0.5 font-mono">{r.recommendation}</div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-bg-secondary flex-shrink-0">
          <button
            onClick={openInCode}
            className="px-3 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent/80 transition-colors"
          >
            Open in Code
          </button>
          <span className="text-[10px] text-text-muted ml-auto">
            {tableInfo.columns.length} columns
            {tableInfo.indexes.length > 0 && ` | ${tableInfo.indexes.length} indexes`}
            {tableInfo.foreignKeys.length > 0 && ` | ${tableInfo.foreignKeys.length} FKs`}
          </span>
        </div>
      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slideIn 0.2s ease-out;
        }
      `}</style>
    </>
  );
}

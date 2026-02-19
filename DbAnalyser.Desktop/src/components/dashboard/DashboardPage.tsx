import { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';

interface StatCard {
  label: string;
  value: number;
  page: string;
  color?: string;
}

function SkeletonCard() {
  return (
    <div className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
      <div className="h-8 w-12 bg-bg-hover rounded mb-2" />
      <div className="h-3 w-16 bg-bg-hover rounded" />
    </div>
  );
}

export function DashboardPage() {
  const databaseName = useStore((s) => s.databaseName);
  const navigate = useNavigate();

  // Primary: always load schema
  const { status: schemaStatus } = useAnalyzer('schema');

  // Auto-trigger relationships after schema loads
  const runAnalyzer = useStore((s) => s.runAnalyzer);
  const relsStatus = useStore((s) => s.analyzerStatus.relationships);
  useEffect(() => {
    if (schemaStatus === 'loaded' && relsStatus === 'idle') {
      runAnalyzer('relationships');
    }
  }, [schemaStatus, relsStatus, runAnalyzer]);

  const result = useStore((s) => s.result);

  const cards = useMemo<StatCard[]>(() => {
    const c: StatCard[] = [];
    const schema = result?.schema;
    const rels = result?.relationships;

    if (schema) {
      c.push({ label: 'Tables', value: schema.tables.length, page: '/schema', color: '#e94560' });
      c.push({ label: 'Views', value: schema.views.length, page: '/schema', color: '#4ecca3' });
      c.push({ label: 'Procedures', value: schema.storedProcedures.length, page: '/schema', color: '#f0a500' });
      c.push({ label: 'Functions', value: schema.functions.length, page: '/schema', color: '#bb86fc' });
      if (schema.triggers.length > 0)
        c.push({ label: 'Triggers', value: schema.triggers.length, page: '/schema', color: '#ff7043' });
      if (schema.synonyms.length > 0)
        c.push({ label: 'Synonyms', value: schema.synonyms.length, page: '/schema', color: '#78909c' });
      if (schema.jobs.length > 0)
        c.push({ label: 'Jobs', value: schema.jobs.length, page: '/schema', color: '#26a69a' });
    }

    if (rels) {
      c.push({ label: 'Foreign Keys', value: rels.explicitRelationships.length, page: '/relationships' });
      c.push({ label: 'Dependencies', value: rels.viewDependencies.length, page: '/dependencies' });
      if (rels.implicitRelationships.length > 0)
        c.push({ label: 'Implicit FKs', value: rels.implicitRelationships.length, page: '/relationships', color: '#f0a500' });
    }

    if (result?.qualityIssues) {
      const errors = result.qualityIssues.filter((i) => i.severity === 'error').length;
      const warnings = result.qualityIssues.filter((i) => i.severity === 'warning').length;
      if (errors > 0) c.push({ label: 'Errors', value: errors, page: '/quality', color: '#e94560' });
      if (warnings > 0) c.push({ label: 'Warnings', value: warnings, page: '/quality', color: '#f0a500' });
    }

    if (result?.usageAnalysis) {
      const unused = result.usageAnalysis.objects.filter((o) => o.usageLevel === 'unused').length;
      if (unused > 0) c.push({ label: 'Unused', value: unused, page: '/usage', color: '#e94560' });
    }

    return c;
  }, [result]);

  const schemaLoading = schemaStatus === 'loading' || schemaStatus === 'idle';
  const relsLoading = relsStatus === 'loading' || relsStatus === 'idle';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{databaseName ?? 'Dashboard'}</h2>
        {result?.analyzedAt && (
          <p className="text-xs text-text-muted mt-1">
            Analyzed at {new Date(result.analyzedAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {schemaLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : null}
        {cards.map((card) => (
          <button
            key={card.label}
            onClick={() => navigate(card.page)}
            className="bg-bg-card border border-border rounded-lg p-4 text-left hover:border-accent/50 hover:bg-bg-hover transition-colors group"
          >
            <p
              className="text-2xl font-bold"
              style={{ color: card.color ?? '#4fc3f7' }}
            >
              {card.value}
            </p>
            <p className="text-xs text-text-secondary mt-1 group-hover:text-text-primary transition-colors">
              {card.label}
            </p>
          </button>
        ))}
        {!schemaLoading && relsLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : null}
      </div>

      {result?.profiles && result.profiles.length > 0 && (
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">Largest Tables</h3>
          <div className="space-y-2">
            {result.profiles
              .sort((a, b) => b.rowCount - a.rowCount)
              .slice(0, 10)
              .map((p) => (
                <div key={p.fullName} className="flex items-center gap-3">
                  <span className="text-xs text-text-primary w-48 truncate">{p.fullName}</span>
                  <div className="flex-1 h-2 bg-bg-primary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent/60 rounded-full"
                      style={{
                        width: `${Math.min(100, (p.rowCount / (result.profiles![0]?.rowCount || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-text-muted w-20 text-right">
                    {p.rowCount.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

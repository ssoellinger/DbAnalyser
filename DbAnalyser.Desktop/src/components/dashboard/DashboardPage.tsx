import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../hooks/useStore';

interface StatCard {
  label: string;
  value: number;
  page: string;
  color?: string;
}

export function DashboardPage() {
  const result = useStore((s) => s.result)!;
  const navigate = useNavigate();

  const cards = useMemo<StatCard[]>(() => {
    const c: StatCard[] = [];
    const schema = result.schema;
    const rels = result.relationships;

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

    if (result.qualityIssues) {
      const errors = result.qualityIssues.filter((i) => i.severity === 'error').length;
      const warnings = result.qualityIssues.filter((i) => i.severity === 'warning').length;
      if (errors > 0) c.push({ label: 'Errors', value: errors, page: '/quality', color: '#e94560' });
      if (warnings > 0) c.push({ label: 'Warnings', value: warnings, page: '/quality', color: '#f0a500' });
    }

    return c;
  }, [result]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{result.databaseName}</h2>
        <p className="text-xs text-text-muted mt-1">
          Analyzed at {new Date(result.analyzedAt).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
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
      </div>

      {result.profiles && result.profiles.length > 0 && (
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

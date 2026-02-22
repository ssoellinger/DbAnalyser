import { useStore } from '../../hooks/useStore';
import type { ConnectionHistoryEntry } from '../../hooks/useStore';

interface ConnectionHistoryProps {
  onSelect: (entry: ConnectionHistoryEntry) => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  sqlserver: 'SQL Server',
  postgresql: 'PostgreSQL',
  oracle: 'Oracle',
};

export function ConnectionHistory({ onSelect }: ConnectionHistoryProps) {
  const history = useStore((s) => s.connectionHistory);

  if (history.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs font-medium text-text-secondary mb-3">Recent Connections</h3>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {history.map((entry, i) => (
          <button
            key={i}
            onClick={() => onSelect(entry)}
            className="w-full text-left px-3 py-2 rounded text-xs hover:bg-bg-hover transition-colors group"
          >
            <span className="text-text-primary group-hover:text-accent transition-colors">
              {entry.server} / {entry.database || '(server mode)'}
            </span>
            {entry.providerType && entry.providerType !== 'sqlserver' && (
              <span className="ml-2 text-text-muted">
                ({PROVIDER_LABELS[entry.providerType] ?? entry.providerType})
              </span>
            )}
            {entry.authMode === 'windows' && (
              <span className="ml-2 text-text-muted">(Windows Auth)</span>
            )}
            {entry.encryptedUsername && (
              <span className="ml-2 text-text-muted">(saved credentials)</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

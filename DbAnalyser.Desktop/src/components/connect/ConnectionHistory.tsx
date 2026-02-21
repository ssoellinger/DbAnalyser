import { useStore } from '../../hooks/useStore';

interface ConnectionHistoryProps {
  onSelect: (connectionString: string, providerType?: string) => void;
  onConnect: (connectionString: string, providerType?: string) => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  sqlserver: 'SQL Server',
  postgresql: 'PostgreSQL',
  oracle: 'Oracle',
};

export function ConnectionHistory({ onSelect, onConnect }: ConnectionHistoryProps) {
  const history = useStore((s) => s.connectionHistory);

  if (history.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs font-medium text-text-secondary mb-3">Recent Connections</h3>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {history.map((entry, i) => (
          <button
            key={i}
            onClick={() => onSelect(entry.connectionString, entry.providerType)}
            onDoubleClick={() => onConnect(entry.connectionString, entry.providerType)}
            className="w-full text-left px-3 py-2 rounded text-xs hover:bg-bg-hover transition-colors group"
          >
            <span className="text-text-primary group-hover:text-accent transition-colors">
              {entry.databaseName}
            </span>
            {entry.providerType && entry.providerType !== 'sqlserver' && (
              <span className="ml-2 text-text-muted">
                ({PROVIDER_LABELS[entry.providerType] ?? entry.providerType})
              </span>
            )}
            <span className="block text-text-muted truncate mt-0.5">
              {entry.connectionString.substring(0, 60)}...
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

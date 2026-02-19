import { useStore } from '../../hooks/useStore';

interface ConnectionHistoryProps {
  onSelect: (connectionString: string) => void;
}

export function ConnectionHistory({ onSelect }: ConnectionHistoryProps) {
  const history = useStore((s) => s.connectionHistory);

  if (history.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4">
      <h3 className="text-xs font-medium text-text-secondary mb-3">Recent Connections</h3>
      <div className="space-y-1">
        {history.map((entry, i) => (
          <button
            key={i}
            onClick={() => onSelect(entry.connectionString)}
            className="w-full text-left px-3 py-2 rounded text-xs hover:bg-bg-hover transition-colors group"
          >
            <span className="text-text-primary group-hover:text-accent transition-colors">
              {entry.databaseName}
            </span>
            <span className="block text-text-muted truncate mt-0.5">
              {entry.connectionString.substring(0, 60)}...
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

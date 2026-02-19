import { useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { api, createSignalRConnection, onProgress } from '../../api/client';

const ALL_ANALYZERS = ['schema', 'profiling', 'relationships', 'quality'];
const DEFAULT_ANALYZERS = ['schema', 'relationships', 'quality'];

export function ConnectionForm() {
  const [connectionString, setConnectionString] = useState('');
  const [analyzers, setAnalyzers] = useState<string[]>(DEFAULT_ANALYZERS);
  const store = useStore();

  const toggleAnalyzer = (name: string) => {
    setAnalyzers((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name]
    );
  };

  const handleConnect = async () => {
    if (!connectionString.trim()) return;

    store.setConnecting(true);
    try {
      // Connect
      const { sessionId, databaseName } = await api.connect(connectionString);
      store.setConnected(sessionId, databaseName);
      store.addToHistory(connectionString, databaseName);

      // Set up SignalR for progress
      const connection = createSignalRConnection();
      await connection.start();

      store.setAnalyzing(true);

      const cleanup = onProgress(connection, (progress) => {
        store.setProgress(progress);
      });

      // Run analysis
      const result = await api.startAnalysis(sessionId, analyzers, connection.connectionId ?? undefined);
      store.setResult(result);

      cleanup();
      await connection.stop();
    } catch (err) {
      store.setConnectionError(err instanceof Error ? err.message : 'Connection failed');
      store.setAnalyzing(false);
    }
  };

  return (
    <div className="bg-bg-card border border-border rounded-lg p-6 space-y-4">
      <div>
        <label className="block text-sm text-text-secondary mb-1.5">Connection String</label>
        <textarea
          value={connectionString}
          onChange={(e) => setConnectionString(e.target.value)}
          placeholder="Server=localhost;Database=MyDb;Trusted_Connection=true;TrustServerCertificate=true"
          rows={3}
          className="w-full bg-bg-primary border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none resize-none"
        />
      </div>

      <div>
        <label className="block text-sm text-text-secondary mb-2">Analyzers</label>
        <div className="flex flex-wrap gap-2">
          {ALL_ANALYZERS.map((name) => (
            <button
              key={name}
              onClick={() => toggleAnalyzer(name)}
              className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${
                analyzers.includes(name)
                  ? 'bg-accent/20 border-accent/50 text-accent'
                  : 'bg-bg-primary border-border text-text-muted'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {store.connectionError && (
        <p className="text-sm text-severity-error">{store.connectionError}</p>
      )}

      <button
        onClick={handleConnect}
        disabled={store.isConnecting || !connectionString.trim() || analyzers.length === 0}
        className="w-full py-2.5 rounded bg-accent text-bg-primary font-medium text-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {store.isConnecting ? 'Connecting...' : 'Connect & Analyze'}
      </button>
    </div>
  );
}

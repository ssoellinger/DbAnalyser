import { useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { api } from '../../api/client';

export function ConnectionForm() {
  const [connectionString, setConnectionString] = useState('');
  const store = useStore();

  const handleConnect = async () => {
    if (!connectionString.trim()) return;

    store.setConnecting(true);
    try {
      const { sessionId, databaseName } = await api.connect(connectionString);
      store.setConnected(sessionId, databaseName);
      store.addToHistory(connectionString, databaseName);
    } catch (err) {
      store.setConnectionError(err instanceof Error ? err.message : 'Connection failed');
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

      {store.connectionError && (
        <p className="text-sm text-severity-error">{store.connectionError}</p>
      )}

      <button
        onClick={handleConnect}
        disabled={store.isConnecting || !connectionString.trim()}
        className="w-full py-2.5 rounded bg-accent text-bg-primary font-medium text-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {store.isConnecting ? 'Connecting...' : 'Connect'}
      </button>
    </div>
  );
}

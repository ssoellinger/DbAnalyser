import { useEffect, useState, useCallback } from 'react';
import { useStore } from '../../hooks/useStore';
import { api } from '../../api/client';
import { ConnectionForm, DEFAULT_FIELDS, parseConnectionString, buildConnectionString } from './ConnectionForm';
import { ConnectionHistory } from './ConnectionHistory';
import type { ConnectionFields } from './ConnectionForm';

const PROVIDER_LABELS: Record<string, string> = {
  sqlserver: 'SQL Server',
  postgresql: 'PostgreSQL',
  oracle: 'Oracle',
};

export function ConnectionPage() {
  const loadHistory = useStore((s) => s.loadHistory);
  const [fields, setFields] = useState<ConnectionFields>(DEFAULT_FIELDS);
  const [rawMode, setRawMode] = useState(false);
  const [rawConnectionString, setRawConnectionString] = useState('');
  const [providerType, setProviderType] = useState('sqlserver');
  const [availableProviders, setAvailableProviders] = useState<string[]>(['sqlserver']);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    api.getProviders()
      .then(({ providers }) => setAvailableProviders(providers))
      .catch(() => { /* API not ready yet — keep default */ });
  }, []);

  const store = useStore();

  const handleSelectHistory = (connectionString: string, historyProviderType?: string) => {
    const pt = historyProviderType ?? 'sqlserver';
    setFields(parseConnectionString(connectionString, pt));
    setRawConnectionString(connectionString);
    setRawMode(false);
    if (historyProviderType) setProviderType(historyProviderType);
  };

  const handleConnectHistory = useCallback(async (connectionString: string, historyProviderType?: string) => {
    const pt = historyProviderType ?? 'sqlserver';
    store.setConnecting(true);
    try {
      const { sessionId, databaseName, isServerMode, serverName } = await api.connect(connectionString, pt);
      await store.initSignalR();
      store.setConnected(sessionId, databaseName, isServerMode, serverName);
      store.addToHistory(connectionString, databaseName ?? serverName ?? 'Server', pt);
    } catch (err) {
      store.setConnectionError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [store]);

  const handleToggleMode = () => {
    if (rawMode) {
      setFields(parseConnectionString(rawConnectionString, providerType));
    } else {
      setRawConnectionString(buildConnectionString(fields, providerType));
    }
    setRawMode(!rawMode);
  };

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-between pt-12 p-8">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex justify-center mb-4">
          <img src="/logo.svg" alt="DB Analyser" className="h-36" />
        </div>

        {availableProviders.length > 1 && (
          <div className="flex gap-1 bg-bg-card border border-border rounded-lg p-1">
            {availableProviders.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setProviderType(p);
                  if (p === 'sqlserver') {
                    setFields({ ...DEFAULT_FIELDS });
                  } else {
                    setFields({ ...DEFAULT_FIELDS, authMode: 'sql' });
                  }
                  setRawConnectionString('');
                  setRawMode(false);
                }}
                className={`flex-1 py-2 text-xs rounded transition-colors ${
                  providerType === p
                    ? 'bg-accent text-bg-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {PROVIDER_LABELS[p] ?? p}
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleToggleMode}
            className="text-xs text-text-muted hover:text-accent transition-colors"
          >
            {rawMode ? 'Form mode' : 'Connection string'}
          </button>
        </div>

        <ConnectionForm
          fields={fields}
          setFields={setFields}
          rawMode={rawMode}
          rawConnectionString={rawConnectionString}
          setRawConnectionString={setRawConnectionString}
          providerType={providerType}
        />

        <ConnectionHistory
          onSelect={handleSelectHistory}
          onConnect={handleConnectHistory}
        />
      </div>

      <p className="text-xs text-text-muted mt-8">
        v{__APP_VERSION__} &middot; by Simon Soellinger
      </p>
    </div>
  );
}

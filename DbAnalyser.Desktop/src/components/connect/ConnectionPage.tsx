import { useEffect, useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { api } from '../../api/client';
import { ConnectionForm, DEFAULT_FIELDS, parseConnectionString, buildConnectionString } from './ConnectionForm';
import { ConnectionHistory } from './ConnectionHistory';
import type { ConnectionFields } from './ConnectionForm';
import type { ConnectionHistoryEntry } from '../../hooks/useStore';
import type { DbaFile } from '../../api/types';

const PROVIDER_LABELS: Record<string, string> = {
  sqlserver: 'SQL Server',
  postgresql: 'PostgreSQL',
  oracle: 'Oracle',
};

export function ConnectionPage() {
  const loadHistory = useStore((s) => s.loadHistory);
  const loadFromFile = useStore((s) => s.loadFromFile);
  const [fields, setFields] = useState<ConnectionFields>(DEFAULT_FIELDS);
  const [rawMode, setRawMode] = useState(false);
  const [rawConnectionString, setRawConnectionString] = useState('');
  const [providerType, setProviderType] = useState('sqlserver');
  const [availableProviders, setAvailableProviders] = useState<string[]>(['sqlserver']);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    api.getProviders()
      .then(({ providers }) => setAvailableProviders(providers))
      .catch(() => { /* API not ready yet — keep default */ });
  }, []);

  const handleSelectHistory = async (entry: ConnectionHistoryEntry) => {
    // Decrypt credentials from OS credential store
    let username = '';
    let password = '';
    if (entry.encryptedUsername) {
      username = (await window.electronAPI?.decrypt(entry.encryptedUsername)) ?? '';
    }
    if (entry.encryptedPassword) {
      password = (await window.electronAPI?.decrypt(entry.encryptedPassword)) ?? '';
    }

    const restoredFields: ConnectionFields = {
      ...DEFAULT_FIELDS,
      server: entry.server,
      port: entry.port,
      database: entry.database,
      authMode: entry.authMode,
      username,
      password,
    };
    setFields(restoredFields);
    setRawConnectionString(buildConnectionString(restoredFields, entry.providerType));
    setRawMode(false);
    setProviderType(entry.providerType);
  };

  const handleOpenFile = async () => {
    setFileError(null);
    const result = await window.electronAPI?.openFile();
    if (!result) return; // cancelled
    try {
      const data = JSON.parse(result.content) as DbaFile;
      if (data.version !== 1 || !data.result) {
        setFileError('Invalid or unsupported .dba file format.');
        return;
      }
      loadFromFile(data, result.filePath);
    } catch {
      setFileError('Could not read file. Make sure it is a valid .dba file.');
    }
  };

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
        />

        <div className="flex items-center gap-3 my-2">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-text-muted">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <button
          onClick={handleOpenFile}
          className="w-full py-2.5 rounded border border-border text-sm text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
        >
          Open Saved Analysis
        </button>

        {fileError && (
          <p className="text-xs text-severity-error text-center">{fileError}</p>
        )}
      </div>

      <p className="text-xs text-text-muted mt-8">
        v{__APP_VERSION__} &middot; by Simon Soellinger
      </p>
    </div>
  );
}

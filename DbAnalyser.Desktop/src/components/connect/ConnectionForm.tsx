import { useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { api } from '../../api/client';

export interface ConnectionFields {
  server: string;
  database: string;
  authMode: 'windows' | 'sql';
  username: string;
  password: string;
  encrypt: boolean;
  trustCertificate: boolean;
}

export const DEFAULT_FIELDS: ConnectionFields = {
  server: '',
  database: '',
  authMode: 'windows',
  username: '',
  password: '',
  encrypt: true,
  trustCertificate: true,
};

export function buildConnectionString(f: ConnectionFields): string {
  const parts: string[] = [
    `Server=${f.server}`,
  ];
  if (f.database.trim()) parts.push(`Database=${f.database}`);
  if (f.authMode === 'windows') {
    parts.push('Trusted_Connection=true');
  } else {
    parts.push(`User Id=${f.username}`);
    parts.push(`Password=${f.password}`);
  }
  if (f.encrypt) parts.push('Encrypt=true');
  if (f.trustCertificate) parts.push('TrustServerCertificate=true');
  return parts.join(';');
}

export function parseConnectionString(cs: string): ConnectionFields {
  const fields = { ...DEFAULT_FIELDS };
  const pairs = cs.split(';').map((p) => p.trim()).filter(Boolean);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.substring(0, eq).trim().toLowerCase();
    const val = pair.substring(eq + 1).trim();
    if (key === 'server' || key === 'data source') fields.server = val;
    else if (key === 'database' || key === 'initial catalog') fields.database = val;
    else if (key === 'user id' || key === 'uid') { fields.username = val; fields.authMode = 'sql'; }
    else if (key === 'password' || key === 'pwd') { fields.password = val; fields.authMode = 'sql'; }
    else if (key === 'trusted_connection' || key === 'integrated security') {
      if (val.toLowerCase() === 'true' || val.toLowerCase() === 'sspi') fields.authMode = 'windows';
    }
    else if (key === 'encrypt') fields.encrypt = val.toLowerCase() === 'true';
    else if (key === 'trustservercertificate') fields.trustCertificate = val.toLowerCase() === 'true';
  }
  return fields;
}

interface ConnectionFormProps {
  fields: ConnectionFields;
  setFields: (fields: ConnectionFields) => void;
  rawMode: boolean;
  rawConnectionString: string;
  setRawConnectionString: (value: string) => void;
}

export function ConnectionForm({ fields, setFields, rawMode, rawConnectionString, setRawConnectionString }: ConnectionFormProps) {
  const store = useStore();
  const [showPassword, setShowPassword] = useState(false);

  const connectionString = rawMode ? rawConnectionString : buildConnectionString(fields);
  const canConnect = rawMode
    ? rawConnectionString.trim().length > 0
    : fields.server.trim().length > 0;

  const handleConnect = async () => {
    if (!canConnect) return;

    store.setConnecting(true);
    try {
      const { sessionId, databaseName, isServerMode, serverName } = await api.connect(connectionString);
      await store.initSignalR();
      store.setConnected(sessionId, databaseName, isServerMode, serverName);
      store.addToHistory(connectionString, databaseName ?? serverName ?? 'Server');
    } catch (err) {
      store.setConnectionError(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  const update = (patch: Partial<ConnectionFields>) => setFields({ ...fields, ...patch });

  const inputClass = 'w-full bg-bg-primary border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none';

  return (
    <div className="bg-bg-card border border-border rounded-lg p-6 space-y-4">
      {rawMode ? (
        <div>
          <label className="block text-xs text-text-secondary mb-1.5">Connection String</label>
          <textarea
            value={rawConnectionString}
            onChange={(e) => setRawConnectionString(e.target.value)}
            placeholder="Server=localhost;Database=MyDb;Trusted_Connection=true;TrustServerCertificate=true"
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Server</label>
              <input
                value={fields.server}
                onChange={(e) => update({ server: e.target.value })}
                placeholder="localhost"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Database <span className="text-text-muted">(optional)</span></label>
              <input
                value={fields.database}
                onChange={(e) => update({ database: e.target.value })}
                placeholder="Leave empty for server-wide analysis"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1.5">Authentication</label>
            <div className="flex gap-1 bg-bg-primary border border-border rounded p-0.5">
              <button
                type="button"
                onClick={() => update({ authMode: 'windows' })}
                className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                  fields.authMode === 'windows'
                    ? 'bg-accent text-bg-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Windows Auth
              </button>
              <button
                type="button"
                onClick={() => update({ authMode: 'sql' })}
                className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                  fields.authMode === 'sql'
                    ? 'bg-accent text-bg-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                SQL Server Auth
              </button>
            </div>
          </div>

          {fields.authMode === 'sql' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">Username</label>
                <input
                  value={fields.username}
                  onChange={(e) => update({ username: e.target.value })}
                  placeholder="sa"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={fields.password}
                    onChange={(e) => update({ password: e.target.value })}
                    className={`${inputClass} pr-8`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-xs"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={fields.encrypt}
                onChange={(e) => update({ encrypt: e.target.checked })}
                className="rounded border-border accent-accent"
              />
              Encrypt
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={fields.trustCertificate}
                onChange={(e) => update({ trustCertificate: e.target.checked })}
                className="rounded border-border accent-accent"
              />
              Trust Server Certificate
            </label>
          </div>
        </>
      )}

      {store.connectionError && (
        <p className="text-sm text-severity-error">{store.connectionError}</p>
      )}

      <button
        onClick={handleConnect}
        disabled={store.isConnecting || !canConnect}
        className="w-full py-2.5 rounded bg-accent text-bg-primary font-medium text-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {store.isConnecting ? 'Connecting...' : 'Connect'}
      </button>
    </div>
  );
}

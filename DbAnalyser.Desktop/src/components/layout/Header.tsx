import { useStore } from '../../hooks/useStore';
import { api } from '../../api/client';
import type { DbaFile } from '../../api/types';

export function Header() {
  const databaseName = useStore((s) => s.databaseName);
  const sessionId = useStore((s) => s.sessionId);
  const isServerMode = useStore((s) => s.isServerMode);
  const serverName = useStore((s) => s.serverName);
  const result = useStore((s) => s.result);
  const analyzerStatus = useStore((s) => s.analyzerStatus);
  const isFileSession = useStore((s) => s.isFileSession);
  const disconnect = useStore((s) => s.disconnect);
  const toggleSearch = useStore((s) => s.toggleSearch);

  const handleDisconnect = async () => {
    if (sessionId && !isFileSession) {
      try { await api.disconnect(sessionId); } catch { /* ignore */ }
    }
    disconnect();
  };

  const handleSave = async () => {
    if (!result) return;
    const dba: DbaFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      appVersion: __APP_VERSION__,
      metadata: {
        serverName,
        databaseName,
        isServerMode,
        analyzerStatus,
      },
      result,
    };
    const defaultName = `${databaseName ?? serverName ?? 'analysis'}.dba`;
    await window.electronAPI?.saveFile(JSON.stringify(dba, null, 2), defaultName);
  };

  return (
    <header className="h-14 bg-bg-secondary border-b border-border flex items-center px-6 gap-4 flex-shrink-0">
      <h1 className="text-sm font-medium text-text-primary">
        {databaseName ?? 'DbAnalyser'}
      </h1>

      <button
        onClick={toggleSearch}
        className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded bg-bg-card border border-border text-text-secondary text-xs hover:border-accent/50 transition-colors"
      >
        Search
        <kbd className="text-[10px] px-1 py-0.5 rounded bg-bg-primary border border-border">Ctrl+K</kbd>
      </button>

      {result && (
        <button
          onClick={handleSave}
          className="px-3 py-1.5 rounded text-xs text-text-secondary hover:text-accent border border-border hover:border-accent/50 transition-colors"
        >
          Save
        </button>
      )}

      <button
        onClick={handleDisconnect}
        className="px-3 py-1.5 rounded text-xs text-text-secondary hover:text-severity-error border border-border hover:border-severity-error/50 transition-colors"
      >
        {isFileSession ? 'Close' : 'Disconnect'}
      </button>
    </header>
  );
}

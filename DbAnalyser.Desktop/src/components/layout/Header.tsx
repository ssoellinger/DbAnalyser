import { useStore } from '../../hooks/useStore';
import { api } from '../../api/client';

export function Header() {
  const databaseName = useStore((s) => s.databaseName);
  const sessionId = useStore((s) => s.sessionId);
  const disconnect = useStore((s) => s.disconnect);
  const toggleSearch = useStore((s) => s.toggleSearch);

  const handleDisconnect = async () => {
    if (sessionId) {
      try { await api.disconnect(sessionId); } catch { /* ignore */ }
    }
    disconnect();
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

      <button
        onClick={handleDisconnect}
        className="px-3 py-1.5 rounded text-xs text-text-secondary hover:text-severity-error border border-border hover:border-severity-error/50 transition-colors"
      >
        Disconnect
      </button>
    </header>
  );
}

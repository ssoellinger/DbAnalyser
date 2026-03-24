import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { SearchDialog } from '../shared/SearchDialog';
import { TableDetailPanel } from '../shared/TableDetailPanel';
import { ShortcutsPanel } from '../shared/ShortcutsPanel';
import { useStore } from '../../hooks/useStore';

export function AppShell({ children }: { children: ReactNode }) {
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      <Sidebar />
      <div className={`flex flex-col flex-1 min-w-0 transition-all ${sidebarCollapsed ? 'ml-16' : 'ml-56'}`}>
        <Header />
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
      <SearchDialog />
      <TableDetailPanel />
      <ShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

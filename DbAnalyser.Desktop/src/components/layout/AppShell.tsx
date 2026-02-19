import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { SearchDialog } from '../shared/SearchDialog';
import { useStore } from '../../hooks/useStore';

export function AppShell({ children }: { children: ReactNode }) {
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);

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
    </div>
  );
}

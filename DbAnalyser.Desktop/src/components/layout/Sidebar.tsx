import { NavLink } from 'react-router-dom';
import { useStore } from '../../hooks/useStore';
import type { AnalyzerName, AnalyzerStatus } from '../../api/types';

const NAV_ITEMS: { path: string; label: string; icon: string; analyzer?: AnalyzerName }[] = [
  { path: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { path: '/dependencies', label: 'Dependencies', icon: '⊶', analyzer: 'relationships' },
  { path: '/erd', label: 'ERD', icon: '⊡', analyzer: 'schema' },
  { path: '/lineage', label: 'Lineage', icon: '⇢', analyzer: 'relationships' },
  { path: '/schema', label: 'Schema', icon: '⊟', analyzer: 'schema' },
  { path: '/profiling', label: 'Profiling', icon: '⊠', analyzer: 'profiling' },
  { path: '/relationships', label: 'Relationships', icon: '⋈', analyzer: 'relationships' },
  { path: '/quality', label: 'Quality', icon: '⚑', analyzer: 'quality' },
  { path: '/usage', label: 'Usage', icon: '◎', analyzer: 'usage' },
];

function StatusDot({ status }: { status: AnalyzerStatus }) {
  if (status === 'loaded') {
    return <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />;
  }
  if (status === 'loading') {
    return <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />;
  }
  if (status === 'error') {
    return <span className="w-1.5 h-1.5 rounded-full bg-severity-error flex-shrink-0" />;
  }
  // idle
  return <span className="w-1.5 h-1.5 rounded-full bg-text-muted/30 flex-shrink-0" />;
}

export function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const databaseName = useStore((s) => s.databaseName);
  const isServerMode = useStore((s) => s.isServerMode);
  const serverName = useStore((s) => s.serverName);
  const analyzerStatus = useStore((s) => s.analyzerStatus);

  return (
    <aside
      className={`fixed top-0 left-0 h-full bg-bg-secondary border-r border-border flex flex-col transition-all z-20 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      <div className="flex items-center h-14 px-4 border-b border-border">
        <img src="/icon.svg" alt="DbAnalyser" className="w-10 h-10 flex-shrink-0" />
        {!collapsed && (
          <span className="text-accent font-semibold text-sm truncate ml-2">
            {isServerMode ? `Server: ${serverName}` : (databaseName ?? 'DbAnalyser')}
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className="ml-auto text-text-secondary hover:text-text-primary transition-colors text-lg"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '▸' : '◂'}
        </button>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV_ITEMS.map(({ path, label, icon, analyzer }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'text-accent bg-bg-hover border-r-2 border-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`
            }
          >
            <span className="text-base w-5 text-center flex-shrink-0">{icon}</span>
            {!collapsed && <span className="truncate">{label}</span>}
            {analyzer && (
              <span className={collapsed ? 'ml-auto' : 'ml-auto'}>
                <StatusDot status={analyzerStatus[analyzer]} />
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-border">
        {!collapsed ? (
          <p className="text-[10px] text-text-muted">v{__APP_VERSION__} &middot; by Simon Soellinger</p>
        ) : (
          <p className="text-[10px] text-text-muted text-center">{__APP_VERSION__}</p>
        )}
      </div>
    </aside>
  );
}

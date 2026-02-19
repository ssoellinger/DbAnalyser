import { NavLink } from 'react-router-dom';
import { useStore } from '../../hooks/useStore';

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { path: '/dependencies', label: 'Dependencies', icon: '⊶' },
  { path: '/erd', label: 'ERD', icon: '⊡' },
  { path: '/lineage', label: 'Lineage', icon: '⇢' },
  { path: '/schema', label: 'Schema', icon: '⊟' },
  { path: '/profiling', label: 'Profiling', icon: '⊠' },
  { path: '/relationships', label: 'Relationships', icon: '⋈' },
  { path: '/quality', label: 'Quality', icon: '⚑' },
];

export function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const databaseName = useStore((s) => s.databaseName);

  return (
    <aside
      className={`fixed top-0 left-0 h-full bg-bg-secondary border-r border-border flex flex-col transition-all z-20 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      <div className="flex items-center h-14 px-4 border-b border-border">
        {!collapsed && (
          <span className="text-accent font-semibold text-sm truncate">
            {databaseName ?? 'DbAnalyser'}
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
        {NAV_ITEMS.map(({ path, label, icon }) => (
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
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

import { useRef, useEffect } from 'react';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import { useCodeStore } from './useCodeStore';

const TYPE_ICONS: Record<string, string> = {
  Table: 'T',
  View: 'V',
  Procedure: 'P',
  Function: 'F',
  Trigger: 'Tr',
};

export function CodeTabBar() {
  const tabs = useCodeStore((s) => s.tabs);
  const activeTabId = useCodeStore((s) => s.activeTabId);
  const setActiveTab = useCodeStore((s) => s.setActiveTab);
  const closeTab = useCodeStore((s) => s.closeTab);
  const closeAllTabs = useCodeStore((s) => s.closeAllTabs);
  const closeOtherTabs = useCodeStore((s) => s.closeOtherTabs);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-border bg-bg-secondary overflow-hidden">
      <div className="flex-1 flex overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const color = OBJECT_TYPE_COLORS[tab.objectType] ?? '#666';

          return (
            <button
              key={tab.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => setActiveTab(tab.id)}
              onMouseDown={(e) => {
                // Middle click to close
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
              className={`group flex items-center gap-1.5 px-3 py-2 text-xs border-r border-border whitespace-nowrap transition-colors flex-shrink-0 ${
                isActive
                  ? 'bg-bg-card text-text-primary border-b-2 border-b-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              <span
                className="text-[9px] font-bold px-1 rounded"
                style={{ backgroundColor: `${color}30`, color }}
              >
                {TYPE_ICONS[tab.objectType] ?? '?'}
              </span>
              <span className="max-w-[120px] truncate">{tab.label}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-bg-hover text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
              >
                &times;
              </span>
            </button>
          );
        })}
      </div>

      {tabs.length > 1 && (
        <button
          onClick={closeAllTabs}
          className="px-2 py-2 text-[10px] text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
          title="Close all tabs"
        >
          Close All
        </button>
      )}
    </div>
  );
}

import { create } from 'zustand';

export interface CodeTab {
  id: string;           // unique key: "type:fullName" e.g. "Procedure:dbo.GetUsers"
  objectType: string;   // Table, View, Procedure, Function, Trigger
  fullName: string;     // e.g. "dbo.GetUsers"
  label: string;        // short display name
  definition: string;   // SQL code
  scrollPos?: number;   // saved scroll position
  goToLine?: number;    // line to scroll to after opening
}

export type ExplorerSort = 'name' | 'modified';

interface CodeState {
  tabs: CodeTab[];
  activeTabId: string | null;
  explorerFilter: string;
  explorerCollapsed: Record<string, boolean>;
  explorerSort: ExplorerSort;
  splitTabId: string | null; // secondary editor in split view

  openTab: (tab: Omit<CodeTab, 'id'>) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (id: string) => void;
  setExplorerFilter: (filter: string) => void;
  toggleExplorerGroup: (group: string) => void;
  setExplorerSort: (sort: ExplorerSort) => void;
  saveScrollPos: (id: string, pos: number) => void;
  clearGoToLine: (id: string) => void;
  toggleSplit: (id: string) => void;
  closeSplit: () => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
}

function makeTabId(type: string, fullName: string) {
  return `${type}:${fullName}`;
}

export const useCodeStore = create<CodeState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  explorerFilter: '',
  explorerCollapsed: {},
  explorerSort: 'name' as ExplorerSort,
  splitTabId: null,

  openTab: (tab) => {
    const id = makeTabId(tab.objectType, tab.fullName);
    const { tabs } = get();
    const existing = tabs.find((t) => t.id === id);
    if (existing) {
      // Update goToLine if provided
      if (tab.goToLine) {
        set({
          tabs: tabs.map((t) => (t.id === id ? { ...t, goToLine: tab.goToLine } : t)),
          activeTabId: id,
        });
      } else {
        set({ activeTabId: id });
      }
      return;
    }
    set({
      tabs: [...tabs, { ...tab, id }],
      activeTabId: id,
    });
  },

  closeTab: (id) => {
    const { tabs, activeTabId, splitTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const newTabs = tabs.filter((t) => t.id !== id);
    let newActive = activeTabId;
    if (activeTabId === id) {
      if (newTabs.length === 0) {
        newActive = null;
      } else if (idx >= newTabs.length) {
        newActive = newTabs[newTabs.length - 1].id;
      } else {
        newActive = newTabs[idx].id;
      }
    }
    set({
      tabs: newTabs,
      activeTabId: newActive,
      splitTabId: splitTabId === id ? null : splitTabId,
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  closeAllTabs: () => set({ tabs: [], activeTabId: null, splitTabId: null }),

  closeOtherTabs: (id) => {
    const { tabs } = get();
    set({
      tabs: tabs.filter((t) => t.id === id),
      activeTabId: id,
      splitTabId: null,
    });
  },

  setExplorerFilter: (filter) => set({ explorerFilter: filter }),

  setExplorerSort: (sort) => set({ explorerSort: sort }),

  toggleExplorerGroup: (group) => {
    const { explorerCollapsed } = get();
    set({
      explorerCollapsed: {
        ...explorerCollapsed,
        [group]: !explorerCollapsed[group],
      },
    });
  },

  saveScrollPos: (id, pos) => {
    const { tabs } = get();
    set({
      tabs: tabs.map((t) => (t.id === id ? { ...t, scrollPos: pos } : t)),
    });
  },

  clearGoToLine: (id) => {
    const { tabs } = get();
    set({
      tabs: tabs.map((t) => (t.id === id ? { ...t, goToLine: undefined } : t)),
    });
  },

  toggleSplit: (id) => {
    const { splitTabId, tabs, activeTabId } = get();
    if (splitTabId) {
      // Close split
      set({ splitTabId: null });
    } else {
      // Open split with the previous tab (the one before active), or the next one
      const activeIdx = tabs.findIndex((t) => t.id === activeTabId);
      const otherTab = activeIdx > 0
        ? tabs[activeIdx - 1]
        : tabs.find((t) => t.id !== activeTabId);
      if (otherTab) {
        set({ splitTabId: otherTab.id });
      }
    }
  },

  closeSplit: () => set({ splitTabId: null }),

  moveTab: (fromIndex, toIndex) => {
    const { tabs } = get();
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= tabs.length) return;
    if (toIndex < 0 || toIndex >= tabs.length) return;
    const newTabs = [...tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);
    set({ tabs: newTabs });
  },
}));

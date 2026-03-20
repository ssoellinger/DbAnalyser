import { create } from 'zustand';

export interface CodeTab {
  id: string;           // unique key: "type:fullName" e.g. "Procedure:dbo.GetUsers"
  objectType: string;   // Table, View, Procedure, Function, Trigger
  fullName: string;     // e.g. "dbo.GetUsers"
  label: string;        // short display name
  definition: string;   // SQL code
  scrollPos?: number;   // saved scroll position
}

interface CodeState {
  tabs: CodeTab[];
  activeTabId: string | null;
  explorerFilter: string;
  explorerCollapsed: Record<string, boolean>; // collapsed groups

  openTab: (tab: Omit<CodeTab, 'id'>) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (id: string) => void;
  setExplorerFilter: (filter: string) => void;
  toggleExplorerGroup: (group: string) => void;
  saveScrollPos: (id: string, pos: number) => void;
}

function makeTabId(type: string, fullName: string) {
  return `${type}:${fullName}`;
}

export const useCodeStore = create<CodeState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  explorerFilter: '',
  explorerCollapsed: {},

  openTab: (tab) => {
    const id = makeTabId(tab.objectType, tab.fullName);
    const { tabs } = get();
    const existing = tabs.find((t) => t.id === id);
    if (existing) {
      set({ activeTabId: id });
      return;
    }
    set({
      tabs: [...tabs, { ...tab, id }],
      activeTabId: id,
    });
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
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
    set({ tabs: newTabs, activeTabId: newActive });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  closeAllTabs: () => set({ tabs: [], activeTabId: null }),

  closeOtherTabs: (id) => {
    const { tabs } = get();
    set({
      tabs: tabs.filter((t) => t.id === id),
      activeTabId: id,
    });
  },

  setExplorerFilter: (filter) => set({ explorerFilter: filter }),

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
}));

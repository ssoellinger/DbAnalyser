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

export interface EditorVisualSettings {
  indentGuides: boolean;
  bracketColors: boolean;
  highlightOccurrences: boolean;
  outline: boolean;
}

const VISUAL_SETTINGS_KEY = 'dbanalyser-editor-visual';
const DEFAULTS: EditorVisualSettings = { indentGuides: false, bracketColors: false, highlightOccurrences: false, outline: false };

function getConnectionKey(): string {
  // Import from main store would create a circular dep, so read from the store directly
  // We'll pass the key in from the component instead
  return '_global';
}

function loadAllVisualSettings(): Record<string, EditorVisualSettings> {
  try {
    const raw = localStorage.getItem(VISUAL_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadVisualSettingsForKey(key: string): EditorVisualSettings {
  const all = loadAllVisualSettings();
  return all[key] ? { ...DEFAULTS, ...all[key] } : { ...DEFAULTS };
}

function saveVisualSettingsForKey(key: string, settings: EditorVisualSettings) {
  const all = loadAllVisualSettings();
  all[key] = settings;
  localStorage.setItem(VISUAL_SETTINGS_KEY, JSON.stringify(all));
}

// ── Per-connection session state ──────────────────────────────────────

const SESSION_KEY = 'dbanalyser-code-sessions';

interface SavedTabInfo {
  id: string;
  objectType: string;
  fullName: string;
  label: string;
}

interface SavedSession {
  tabs: SavedTabInfo[];
  activeTabId: string | null;
  splitTabId: string | null;
  explorerCollapsed: Record<string, boolean>;
  explorerSort: ExplorerSort;
}

function loadAllSessions(): Record<string, SavedSession> {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSession(key: string, state: CodeState) {
  const all = loadAllSessions();
  all[key] = {
    tabs: state.tabs.map((t) => ({ id: t.id, objectType: t.objectType, fullName: t.fullName, label: t.label })),
    activeTabId: state.activeTabId,
    splitTabId: state.splitTabId,
    explorerCollapsed: state.explorerCollapsed,
    explorerSort: state.explorerSort,
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(all)); } catch { /* quota */ }
}

function loadSession(key: string): SavedSession | null {
  return loadAllSessions()[key] ?? null;
}

interface CodeState {
  tabs: CodeTab[];
  activeTabId: string | null;
  explorerFilter: string;
  explorerCollapsed: Record<string, boolean>;
  explorerSort: ExplorerSort;
  splitTabId: string | null;
  visualSettings: EditorVisualSettings;
  connectionKey: string;

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
  setVisualSetting: (key: keyof EditorVisualSettings, value: boolean) => void;
  loadVisualSettingsForConnection: (serverName: string | null, databaseName: string | null) => void;
  loadSessionForConnection: (serverName: string | null, databaseName: string | null, resolveDefinition: (objectType: string, fullName: string) => string) => void;
}

function makeTabId(type: string, fullName: string) {
  return `${type}:${fullName}`;
}

function autoSave(get: () => CodeState) {
  const state = get();
  if (state.connectionKey) {
    saveSession(state.connectionKey, state);
  }
}

export const useCodeStore = create<CodeState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  explorerFilter: '',
  explorerCollapsed: {},
  explorerSort: 'name' as ExplorerSort,
  splitTabId: null,
  visualSettings: { ...DEFAULTS },
  connectionKey: '',

  openTab: (tab) => {
    const id = makeTabId(tab.objectType, tab.fullName);
    const { tabs } = get();
    const existing = tabs.find((t) => t.id === id);
    if (existing) {
      if (tab.goToLine) {
        set({
          tabs: tabs.map((t) => (t.id === id ? { ...t, goToLine: tab.goToLine } : t)),
          activeTabId: id,
        });
      } else {
        set({ activeTabId: id });
      }
      autoSave(get);
      return;
    }
    set({
      tabs: [...tabs, { ...tab, id }],
      activeTabId: id,
    });
    autoSave(get);
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
    autoSave(get);
  },

  setActiveTab: (id) => { set({ activeTabId: id }); autoSave(get); },

  closeAllTabs: () => { set({ tabs: [], activeTabId: null, splitTabId: null }); autoSave(get); },

  closeOtherTabs: (id) => {
    const { tabs } = get();
    set({
      tabs: tabs.filter((t) => t.id === id),
      activeTabId: id,
      splitTabId: null,
    });
    autoSave(get);
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
    autoSave(get);
  },

  closeSplit: () => { set({ splitTabId: null }); autoSave(get); },

  moveTab: (fromIndex, toIndex) => {
    const { tabs } = get();
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= tabs.length) return;
    if (toIndex < 0 || toIndex >= tabs.length) return;
    const newTabs = [...tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);
    set({ tabs: newTabs });
    autoSave(get);
  },

  setVisualSetting: (key, value) => {
    const { visualSettings, connectionKey } = get();
    const updated = { ...visualSettings, [key]: value };
    saveVisualSettingsForKey(connectionKey, updated);
    set({ visualSettings: updated });
  },

  loadVisualSettingsForConnection: (serverName, databaseName) => {
    const connKey = [serverName ?? '', databaseName ?? ''].filter(Boolean).join(':') || '_global';
    const settings = loadVisualSettingsForKey(connKey);
    set({ visualSettings: settings, connectionKey: connKey });
  },

  loadSessionForConnection: (serverName, databaseName, resolveDefinition) => {
    const connKey = [serverName ?? '', databaseName ?? ''].filter(Boolean).join(':') || '_global';

    // Save current session before switching (if we have a different connection)
    const current = get();
    if (current.connectionKey && current.connectionKey !== connKey && current.tabs.length > 0) {
      saveSession(current.connectionKey, current);
    }

    // Set the connection key immediately
    set({ connectionKey: connKey });

    const saved = loadSession(connKey);
    if (saved && saved.tabs.length > 0) {
      const restoredTabs: CodeTab[] = saved.tabs
        .map((t) => ({
          ...t,
          definition: resolveDefinition(t.objectType, t.fullName),
          scrollPos: undefined,
          goToLine: undefined,
        }))
        .filter((t) => t.definition);

      const restoredActiveId = restoredTabs.find((t) => t.id === saved.activeTabId)?.id ?? restoredTabs[0]?.id ?? null;
      const restoredSplitId = saved.splitTabId && restoredTabs.find((t) => t.id === saved.splitTabId) ? saved.splitTabId : null;

      set({
        tabs: restoredTabs,
        activeTabId: restoredActiveId,
        splitTabId: restoredSplitId,
        explorerCollapsed: saved.explorerCollapsed ?? {},
        explorerSort: saved.explorerSort ?? 'name',
        explorerFilter: '',
      });
    } else {
      set({
        tabs: [],
        activeTabId: null,
        splitTabId: null,
        explorerCollapsed: {},
        explorerSort: 'name',
        explorerFilter: '',
      });
    }
  },

}));

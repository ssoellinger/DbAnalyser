import { create } from 'zustand';
import type { AnalysisResult, AnalysisProgress } from '../api/types';

interface ConnectionHistoryEntry {
  connectionString: string;
  databaseName: string;
  timestamp: string;
}

interface AppState {
  // Connection
  sessionId: string | null;
  databaseName: string | null;
  isConnecting: boolean;
  connectionError: string | null;

  // Analysis
  result: AnalysisResult | null;
  isAnalyzing: boolean;
  progress: AnalysisProgress | null;

  // UI
  sidebarCollapsed: boolean;
  searchOpen: boolean;

  // History
  connectionHistory: ConnectionHistoryEntry[];

  // Actions
  setConnecting: (isConnecting: boolean) => void;
  setConnected: (sessionId: string, databaseName: string) => void;
  setConnectionError: (error: string | null) => void;
  setAnalyzing: (isAnalyzing: boolean) => void;
  setProgress: (progress: AnalysisProgress | null) => void;
  setResult: (result: AnalysisResult) => void;
  disconnect: () => void;
  toggleSidebar: () => void;
  toggleSearch: () => void;
  addToHistory: (connectionString: string, databaseName: string) => void;
  loadHistory: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  sessionId: null,
  databaseName: null,
  isConnecting: false,
  connectionError: null,
  result: null,
  isAnalyzing: false,
  progress: null,
  sidebarCollapsed: false,
  searchOpen: false,
  connectionHistory: [],

  setConnecting: (isConnecting) => set({ isConnecting, connectionError: null }),
  setConnected: (sessionId, databaseName) =>
    set({ sessionId, databaseName, isConnecting: false, connectionError: null }),
  setConnectionError: (error) => set({ connectionError: error, isConnecting: false }),
  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setProgress: (progress) => set({ progress }),
  setResult: (result) => set({ result, isAnalyzing: false, progress: null }),
  disconnect: () =>
    set({ sessionId: null, databaseName: null, result: null, progress: null }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  addToHistory: (connectionString, databaseName) => {
    const entry: ConnectionHistoryEntry = {
      connectionString,
      databaseName,
      timestamp: new Date().toISOString(),
    };
    const history = [entry, ...get().connectionHistory.filter(
      (h) => h.connectionString !== connectionString
    )].slice(0, 10);
    set({ connectionHistory: history });
    try {
      localStorage.setItem('dbanalyser-history', JSON.stringify(history));
    } catch { /* ignore */ }
  },
  loadHistory: () => {
    try {
      const raw = localStorage.getItem('dbanalyser-history');
      if (raw) set({ connectionHistory: JSON.parse(raw) });
    } catch { /* ignore */ }
  },
}));

import { create } from 'zustand';
import type { AnalysisResult, AnalysisProgress, AnalyzerName, AnalyzerStatus } from '../api/types';
import { api } from '../api/client';

interface ConnectionHistoryEntry {
  connectionString: string;
  databaseName: string;
  timestamp: string;
}

const ALL_ANALYZERS: AnalyzerName[] = ['schema', 'profiling', 'relationships', 'quality', 'usage'];

// Which result fields map to which analyzer
function analyzerStatusFromResult(result: AnalysisResult | null): Record<AnalyzerName, AnalyzerStatus> {
  if (!result) return { schema: 'idle', profiling: 'idle', relationships: 'idle', quality: 'idle', usage: 'idle' };
  return {
    schema: result.schema ? 'loaded' : 'idle',
    profiling: result.profiles ? 'loaded' : 'idle',
    relationships: result.relationships ? 'loaded' : 'idle',
    quality: result.qualityIssues ? 'loaded' : 'idle',
    usage: result.usageAnalysis ? 'loaded' : 'idle',
  };
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

  // Per-analyzer status
  analyzerStatus: Record<AnalyzerName, AnalyzerStatus>;
  analyzerErrors: Record<string, string | null>;

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
  mergeResult: (incoming: AnalysisResult) => void;
  runAnalyzer: (name: AnalyzerName, force?: boolean) => Promise<void>;
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
  analyzerStatus: { schema: 'idle', profiling: 'idle', relationships: 'idle', quality: 'idle', usage: 'idle' },
  analyzerErrors: {},
  sidebarCollapsed: false,
  searchOpen: false,
  connectionHistory: [],

  setConnecting: (isConnecting) => set({ isConnecting, connectionError: null }),
  setConnected: (sessionId, databaseName) =>
    set({ sessionId, databaseName, isConnecting: false, connectionError: null }),
  setConnectionError: (error) => set({ connectionError: error, isConnecting: false }),
  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setProgress: (progress) => set({ progress }),

  setResult: (result) =>
    set({
      result,
      isAnalyzing: false,
      progress: null,
      analyzerStatus: analyzerStatusFromResult(result),
    }),

  mergeResult: (incoming) => {
    const existing = get().result;
    if (!existing) {
      set({
        result: incoming,
        analyzerStatus: analyzerStatusFromResult(incoming),
      });
      return;
    }
    // Overlay non-null sections from incoming onto existing
    const merged: AnalysisResult = {
      databaseName: incoming.databaseName || existing.databaseName,
      analyzedAt: incoming.analyzedAt || existing.analyzedAt,
      schema: incoming.schema ?? existing.schema,
      profiles: incoming.profiles ?? existing.profiles,
      relationships: incoming.relationships ?? existing.relationships,
      qualityIssues: incoming.qualityIssues ?? existing.qualityIssues,
      usageAnalysis: incoming.usageAnalysis ?? existing.usageAnalysis,
    };
    set({
      result: merged,
      analyzerStatus: analyzerStatusFromResult(merged),
    });
  },

  runAnalyzer: async (name, force) => {
    const { sessionId } = get();
    if (!sessionId) return;

    set((s) => ({
      analyzerStatus: { ...s.analyzerStatus, [name]: 'loading' as AnalyzerStatus },
      analyzerErrors: { ...s.analyzerErrors, [name]: null },
    }));

    try {
      const result = await api.runAnalyzer(sessionId, name, force);
      get().mergeResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      set((s) => ({
        analyzerStatus: { ...s.analyzerStatus, [name]: 'error' as AnalyzerStatus },
        analyzerErrors: { ...s.analyzerErrors, [name]: message },
      }));
    }
  },

  disconnect: () =>
    set({
      sessionId: null,
      databaseName: null,
      result: null,
      progress: null,
      analyzerStatus: { schema: 'idle', profiling: 'idle', relationships: 'idle', quality: 'idle', usage: 'idle' },
      analyzerErrors: {},
    }),

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

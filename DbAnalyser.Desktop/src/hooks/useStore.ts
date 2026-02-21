import { create } from 'zustand';
import type { HubConnection } from '@microsoft/signalr';
import type { AnalysisResult, AnalysisProgress, AnalyzerName, AnalyzerStatus } from '../api/types';
import { api, createSignalRConnection, onProgress } from '../api/client';

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
  isServerMode: boolean;
  serverName: string | null;
  isConnecting: boolean;
  connectionError: string | null;

  // Analysis
  result: AnalysisResult | null;
  isAnalyzing: boolean;
  progress: AnalysisProgress | null;

  // Per-analyzer status
  analyzerStatus: Record<AnalyzerName, AnalyzerStatus>;
  analyzerErrors: Record<string, string | null>;
  analyzerAbortControllers: Record<string, AbortController | null>;

  // SignalR
  signalRConnection: HubConnection | null;
  signalRConnectionId: string | null;

  // UI
  sidebarCollapsed: boolean;
  searchOpen: boolean;

  // History
  connectionHistory: ConnectionHistoryEntry[];

  // Actions
  initSignalR: () => Promise<void>;
  setConnecting: (isConnecting: boolean) => void;
  setConnected: (sessionId: string, databaseName: string | null, isServerMode?: boolean, serverName?: string | null) => void;
  setConnectionError: (error: string | null) => void;
  setAnalyzing: (isAnalyzing: boolean) => void;
  setProgress: (progress: AnalysisProgress | null) => void;
  setResult: (result: AnalysisResult) => void;
  mergeResult: (incoming: AnalysisResult) => void;
  runAnalyzer: (name: AnalyzerName, force?: boolean, database?: string) => Promise<void>;
  cancelAnalyzer: (name: AnalyzerName) => void;
  disconnect: () => void;
  toggleSidebar: () => void;
  toggleSearch: () => void;
  addToHistory: (connectionString: string, databaseName: string) => void;
  loadHistory: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  sessionId: null,
  databaseName: null,
  isServerMode: false,
  serverName: null,
  isConnecting: false,
  connectionError: null,
  result: null,
  isAnalyzing: false,
  progress: null,
  analyzerStatus: { schema: 'idle', profiling: 'idle', relationships: 'idle', quality: 'idle', usage: 'idle' },
  analyzerErrors: {},
  analyzerAbortControllers: {},
  signalRConnection: null,
  signalRConnectionId: null,
  sidebarCollapsed: false,
  searchOpen: false,
  connectionHistory: [],

  initSignalR: async () => {
    // Stop any existing connection
    const existing = get().signalRConnection;
    if (existing) {
      try { await existing.stop(); } catch { /* ignore */ }
    }

    const connection = createSignalRConnection();

    // Listen for progress events
    onProgress(connection, (progress) => {
      console.log('[SignalR] progress:', progress);
      get().setProgress(progress);
    });

    try {
      await connection.start();
      console.log('[SignalR] connected, connectionId:', connection.connectionId);
      set({ signalRConnection: connection, signalRConnectionId: connection.connectionId });
    } catch (err) {
      console.warn('SignalR connection failed, progress updates will be unavailable:', err);
      window.electronAPI?.log.warn('SignalR connection failed:', err instanceof Error ? err.message : String(err));
      set({ signalRConnection: null, signalRConnectionId: null });
    }
  },

  setConnecting: (isConnecting) => set({ isConnecting, connectionError: null }),
  setConnected: (sessionId, databaseName, isServerMode = false, serverName = null) =>
    set({ sessionId, databaseName, isServerMode, serverName, isConnecting: false, connectionError: null }),
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
    const merged: AnalysisResult = existing ? {
      databaseName: incoming.databaseName || existing.databaseName,
      analyzedAt: incoming.analyzedAt || existing.analyzedAt,
      schema: incoming.schema ?? existing.schema,
      profiles: incoming.profiles ?? existing.profiles,
      relationships: incoming.relationships ?? existing.relationships,
      qualityIssues: incoming.qualityIssues ?? existing.qualityIssues,
      usageAnalysis: incoming.usageAnalysis ?? existing.usageAnalysis,
      isServerMode: incoming.isServerMode || existing.isServerMode,
      databases: incoming.databases?.length ? incoming.databases : existing.databases,
      failedDatabases: incoming.failedDatabases?.length ? incoming.failedDatabases : existing.failedDatabases,
    } : incoming;
    const newStatus = analyzerStatusFromResult(merged);
    const currentStatus = get().analyzerStatus;
    const controllers = get().analyzerAbortControllers;
    // Preserve 'loading' only for analyzers that still have an active request
    for (const key of ALL_ANALYZERS) {
      if (currentStatus[key] === 'loading' && controllers[key] != null) {
        newStatus[key] = 'loading';
      }
    }
    set({
      result: merged,
      analyzerStatus: newStatus,
    });
  },

  runAnalyzer: async (name, force, database) => {
    const { sessionId, signalRConnectionId } = get();
    if (!sessionId) return;

    // Abort any previous in-flight request for this analyzer
    const prev = get().analyzerAbortControllers[name];
    if (prev) prev.abort();

    const controller = new AbortController();

    console.log('[runAnalyzer]', name, 'signalRConnectionId:', signalRConnectionId, 'database:', database);

    set((s) => ({
      analyzerStatus: { ...s.analyzerStatus, [name]: 'loading' as AnalyzerStatus },
      analyzerErrors: { ...s.analyzerErrors, [name]: null },
      analyzerAbortControllers: { ...s.analyzerAbortControllers, [name]: controller },
      progress: null,
    }));

    try {
      const result = await api.runAnalyzer(sessionId, name, force, signalRConnectionId ?? undefined, database, controller.signal);
      set((s) => ({ analyzerAbortControllers: { ...s.analyzerAbortControllers, [name]: null } }));
      get().mergeResult(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Only reset to idle if no newer request has replaced this one
        if (get().analyzerAbortControllers[name] === controller) {
          set((s) => ({
            analyzerStatus: { ...s.analyzerStatus, [name]: 'idle' as AnalyzerStatus },
            analyzerAbortControllers: { ...s.analyzerAbortControllers, [name]: null },
            progress: null,
          }));
        }
        return;
      }
      const message = err instanceof Error ? err.message : 'Analysis failed';
      window.electronAPI?.log.error(`Analyzer '${name}' failed:`, message);
      set((s) => ({
        analyzerStatus: { ...s.analyzerStatus, [name]: 'error' as AnalyzerStatus },
        analyzerErrors: { ...s.analyzerErrors, [name]: message },
        analyzerAbortControllers: { ...s.analyzerAbortControllers, [name]: null },
      }));
    }
  },

  cancelAnalyzer: (name) => {
    const controller = get().analyzerAbortControllers[name];
    if (controller) controller.abort();
  },

  disconnect: () => {
    // Abort all in-flight analyzers
    const controllers = get().analyzerAbortControllers;
    Object.values(controllers).forEach((c) => c?.abort());

    const connection = get().signalRConnection;
    if (connection) {
      connection.stop().catch(() => { /* ignore */ });
    }
    set({
      sessionId: null,
      databaseName: null,
      isServerMode: false,
      serverName: null,
      result: null,
      progress: null,
      signalRConnection: null,
      signalRConnectionId: null,
      analyzerStatus: { schema: 'idle', profiling: 'idle', relationships: 'idle', quality: 'idle', usage: 'idle' },
      analyzerErrors: {},
      analyzerAbortControllers: {},
    });
  },

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

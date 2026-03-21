import * as signalR from '@microsoft/signalr';
import type { AnalysisResult, ConnectResult, AnalysisProgress, QueryResponse } from './types';

const API_BASE = `http://localhost:${(window as any).electronAPI?.apiPort ?? 5174}`;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),

  getProviders: () => request<{ providers: string[] }>('/api/providers'),

  connect: (connectionString: string, providerType: string = 'sqlserver') =>
    request<ConnectResult>('/api/connect', {
      method: 'POST',
      body: JSON.stringify({ connectionString, providerType }),
    }),

  startAnalysis: (sessionId: string, analyzers?: string[], signalRConnectionId?: string) =>
    request<AnalysisResult>('/api/analysis/start', {
      method: 'POST',
      body: JSON.stringify({ sessionId, analyzers, signalRConnectionId }),
    }),

  getResult: (sessionId: string) =>
    request<AnalysisResult>(`/api/analysis/${sessionId}`),

  runAnalyzer: (sessionId: string, analyzer: string, force?: boolean, signalRConnectionId?: string, database?: string, signal?: AbortSignal) =>
    request<AnalysisResult>(`/api/analysis/run/${sessionId}/${analyzer}`, {
      method: 'POST',
      body: JSON.stringify({ signalRConnectionId, force: force ?? false, database }),
      signal,
    }),

  disconnect: (sessionId: string) =>
    request<{ message: string }>('/api/disconnect', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),

  executeQuery: (sessionId: string, sql: string, maxRows?: number, timeoutSeconds?: number, database?: string, showPlan?: boolean, signal?: AbortSignal) =>
    request<QueryResponse>(`/api/query/${sessionId}`, {
      method: 'POST',
      body: JSON.stringify({ sql, maxRows, timeoutSeconds, database: database || undefined, showPlan: showPlan || false }),
      signal,
    }),

  getQueryDatabases: (sessionId: string) =>
    request<{ databases: string[]; currentDatabase: string | null }>(`/api/query/${sessionId}/databases`),

  beginTransaction: (sessionId: string, database?: string) =>
    request<{ transactionId: string }>(`/api/query/${sessionId}/transaction/begin`, {
      method: 'POST',
      body: JSON.stringify({ database: database || undefined }),
    }),

  commitTransaction: (sessionId: string) =>
    request<{ message: string }>(`/api/query/${sessionId}/transaction/commit`, {
      method: 'POST',
    }),

  rollbackTransaction: (sessionId: string) =>
    request<{ message: string }>(`/api/query/${sessionId}/transaction/rollback`, {
      method: 'POST',
    }),
};

// ── SignalR ─────────────────────────────────────────────────────────────────

export function createSignalRConnection() {
  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${API_BASE}/hubs/analysis`, { withCredentials: false })
    .withAutomaticReconnect()
    .build();

  return connection;
}

export function onProgress(
  connection: signalR.HubConnection,
  callback: (progress: AnalysisProgress) => void
) {
  connection.on('analysisProgress', callback);
  return () => connection.off('analysisProgress', callback);
}

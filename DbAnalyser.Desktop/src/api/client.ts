import * as signalR from '@microsoft/signalr';
import type { AnalysisResult, ConnectResult, AnalysisProgress } from './types';

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

  connect: (connectionString: string) =>
    request<ConnectResult>('/api/connect', {
      method: 'POST',
      body: JSON.stringify({ connectionString }),
    }),

  startAnalysis: (sessionId: string, analyzers?: string[], signalRConnectionId?: string) =>
    request<AnalysisResult>('/api/analysis/start', {
      method: 'POST',
      body: JSON.stringify({ sessionId, analyzers, signalRConnectionId }),
    }),

  getResult: (sessionId: string) =>
    request<AnalysisResult>(`/api/analysis/${sessionId}`),

  runAnalyzer: (sessionId: string, analyzer: string, force?: boolean, signalRConnectionId?: string, database?: string) =>
    request<AnalysisResult>(`/api/analysis/run/${sessionId}/${analyzer}`, {
      method: 'POST',
      body: JSON.stringify({ signalRConnectionId, force: force ?? false, database }),
    }),

  disconnect: (sessionId: string) =>
    request<{ message: string }>('/api/disconnect', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
};

// ── SignalR ─────────────────────────────────────────────────────────────────

export function createSignalRConnection() {
  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${API_BASE}/hubs/analysis`)
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

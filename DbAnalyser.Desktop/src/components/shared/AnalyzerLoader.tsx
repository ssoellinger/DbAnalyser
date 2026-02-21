import type { ReactNode } from 'react';
import type { AnalyzerStatus, AnalysisProgress } from '../../api/types';

interface AnalyzerLoaderProps {
  status: AnalyzerStatus;
  error: string | null;
  onRefresh: () => void;
  onCancel?: () => void;
  analyzerName: string;
  progress?: AnalysisProgress | null;
  children: ReactNode;
}

export function AnalyzerLoader({ status, error, onRefresh, onCancel, analyzerName, progress, children }: AnalyzerLoaderProps) {
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-4 max-w-xs w-full">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          {progress && progress.total > 0 ? (
            <>
              <p className="text-sm text-text-primary font-medium">{progress.step}</p>
              <div className="w-full bg-bg-primary border border-border rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(progress.percentage, 2)}%` }}
                />
              </div>
              <p className="text-xs text-text-muted">
                {progress.current} of {progress.total} &middot; {Math.round(progress.percentage)}%
              </p>
            </>
          ) : (
            <p className="text-sm text-text-secondary">Loading {analyzerName}...</p>
          )}
          {onCancel && status === 'loading' && (
            <button
              onClick={onCancel}
              className="px-4 py-1.5 rounded border border-border text-text-secondary text-xs hover:text-text-primary hover:border-text-muted transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <p className="text-sm text-severity-error">{error ?? `Failed to load ${analyzerName}`}</p>
          <button
            onClick={onRefresh}
            className="px-4 py-2 rounded bg-accent text-bg-primary text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

interface RefreshButtonProps {
  onClick: () => void;
  loading: boolean;
}

export function RefreshButton({ onClick, loading }: RefreshButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
      title="Refresh"
    >
      <svg
        className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
    </button>
  );
}

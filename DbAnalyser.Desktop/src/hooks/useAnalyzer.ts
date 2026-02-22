import { useEffect, useCallback } from 'react';
import { useStore } from './useStore';
import type { AnalyzerName, AnalyzerStatus, AnalysisProgress } from '../api/types';

export function useAnalyzer(name: AnalyzerName, autoLoad = true): {
  status: AnalyzerStatus;
  error: string | null;
  progress: AnalysisProgress | null;
  refresh: () => void;
  cancel: () => void;
} {
  const status = useStore((s) => s.analyzerStatus[name]);
  const error = useStore((s) => s.analyzerErrors[name] ?? null);
  const progress = useStore((s) => s.analyzerStatus[name] === 'loading' ? s.progress : null);
  const runAnalyzer = useStore((s) => s.runAnalyzer);
  const cancelAnalyzer = useStore((s) => s.cancelAnalyzer);
  const isFileSession = useStore((s) => s.isFileSession);

  useEffect(() => {
    if (autoLoad && status === 'idle' && !isFileSession) {
      runAnalyzer(name);
    }
  }, [autoLoad, status, name, runAnalyzer, isFileSession]);

  const refresh = useCallback(() => {
    runAnalyzer(name, true);
  }, [name, runAnalyzer]);

  const cancel = useCallback(() => {
    cancelAnalyzer(name);
  }, [name, cancelAnalyzer]);

  return { status, error, progress, refresh, cancel };
}

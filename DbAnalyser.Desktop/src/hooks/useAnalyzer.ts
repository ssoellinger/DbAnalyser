import { useEffect, useCallback } from 'react';
import { useStore } from './useStore';
import type { AnalyzerName, AnalyzerStatus } from '../api/types';

export function useAnalyzer(name: AnalyzerName): {
  status: AnalyzerStatus;
  error: string | null;
  refresh: () => void;
} {
  const status = useStore((s) => s.analyzerStatus[name]);
  const error = useStore((s) => s.analyzerErrors[name] ?? null);
  const runAnalyzer = useStore((s) => s.runAnalyzer);

  useEffect(() => {
    if (status === 'idle') {
      runAnalyzer(name);
    }
  }, [status, name, runAnalyzer]);

  const refresh = useCallback(() => {
    runAnalyzer(name, true);
  }, [name, runAnalyzer]);

  return { status, error, refresh };
}

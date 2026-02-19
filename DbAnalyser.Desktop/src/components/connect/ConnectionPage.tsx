import { useEffect } from 'react';
import { useStore } from '../../hooks/useStore';
import { ConnectionForm } from './ConnectionForm';
import { ConnectionHistory } from './ConnectionHistory';
import { AnalysisProgress } from './AnalysisProgress';

export function ConnectionPage() {
  const isAnalyzing = useStore((s) => s.isAnalyzing);
  const loadHistory = useStore((s) => s.loadHistory);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-8">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-primary mb-2">DbAnalyser</h1>
          <p className="text-text-secondary text-sm">Database structure and quality analyzer</p>
        </div>

        {isAnalyzing ? <AnalysisProgress /> : <ConnectionForm />}

        <ConnectionHistory />
      </div>
    </div>
  );
}

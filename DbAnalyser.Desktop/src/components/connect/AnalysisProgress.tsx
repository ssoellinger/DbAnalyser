import { useStore } from '../../hooks/useStore';

export function AnalysisProgress() {
  const progress = useStore((s) => s.progress);

  return (
    <div className="bg-bg-card border border-border rounded-lg p-6 space-y-4">
      <h2 className="text-sm font-medium text-text-primary">Analyzing database...</h2>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-text-secondary">
          <span className="capitalize">{progress?.step ?? 'Starting...'}</span>
          <span>{progress?.percentage ?? 0}%</span>
        </div>
        <div className="h-2 bg-bg-primary rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${progress?.percentage ?? 0}%` }}
          />
        </div>
        {progress && (
          <p className="text-xs text-text-muted">
            Step {progress.current} of {progress.total}
          </p>
        )}
      </div>
    </div>
  );
}

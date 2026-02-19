import type { Cycle } from '../../hooks/useCycleDetection';

export function CycleWarning({ cycles }: { cycles: Cycle[] }) {
  if (cycles.length === 0) return null;

  return (
    <div className="bg-severity-error/10 border border-severity-error/30 rounded-lg px-4 py-3">
      <p className="text-sm font-medium text-severity-error mb-2">
        {cycles.length} Circular Dependency {cycles.length === 1 ? 'Cycle' : 'Cycles'} Detected
      </p>
      <div className="space-y-1">
        {cycles.map((cycle, i) => (
          <p key={i} className="text-xs text-text-secondary">
            {cycle.nodes.join(' → ')} → {cycle.nodes[0]}
          </p>
        ))}
      </div>
    </div>
  );
}

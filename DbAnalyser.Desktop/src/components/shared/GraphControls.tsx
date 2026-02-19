import { useReactFlow } from '@xyflow/react';

interface GraphControlsProps {
  onAutoLayout?: () => void;
}

export function GraphControls({ onAutoLayout }: GraphControlsProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();

  const handleFullscreen = () => {
    const el = document.querySelector('.react-flow') as HTMLElement;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  };

  return (
    <div className="absolute top-3 right-3 flex gap-1 z-10">
      <button
        onClick={() => zoomIn()}
        className="w-8 h-8 flex items-center justify-center rounded bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-sm transition-colors"
        title="Zoom in"
      >
        +
      </button>
      <button
        onClick={() => zoomOut()}
        className="w-8 h-8 flex items-center justify-center rounded bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-sm transition-colors"
        title="Zoom out"
      >
        −
      </button>
      <button
        onClick={() => fitView({ padding: 0.1 })}
        className="w-8 h-8 flex items-center justify-center rounded bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-sm transition-colors"
        title="Fit view"
      >
        ⊡
      </button>
      {onAutoLayout && (
        <button
          onClick={onAutoLayout}
          className="w-8 h-8 flex items-center justify-center rounded bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-sm transition-colors"
          title="Auto layout"
        >
          ⊞
        </button>
      )}
      <button
        onClick={handleFullscreen}
        className="w-8 h-8 flex items-center justify-center rounded bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-sm transition-colors"
        title="Fullscreen"
      >
        ⛶
      </button>
    </div>
  );
}

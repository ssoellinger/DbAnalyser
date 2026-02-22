import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';

interface GraphControlsProps {
  onAutoLayout?: () => void;
}

export function GraphControls({ onAutoLayout }: GraphControlsProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleFullscreen = () => {
    const el = document.querySelector('.react-flow') as HTMLElement;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const btnClass =
    'w-8 h-8 flex items-center justify-center rounded bg-bg-primary/80 border border-border text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors';

  return (
    <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
      <button onClick={() => zoomIn()} className={btnClass} title="Zoom in">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>
      <button onClick={() => zoomOut()} className={btnClass} title="Zoom out">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>
      <button onClick={() => fitView({ padding: 0.05 })} className={btnClass} title="Fit to view">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3,2" />
          <polyline points="5,7 5,5 7,5" />
          <polyline points="11,9 11,11 9,11" />
        </svg>
      </button>
      {onAutoLayout && (
        <button onClick={onAutoLayout} className={btnClass} title="Auto layout">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="5" height="5" rx="1" />
            <rect x="9" y="2" width="5" height="5" rx="1" />
            <rect x="2" y="9" width="5" height="5" rx="1" />
            <rect x="9" y="9" width="5" height="5" rx="1" />
          </svg>
        </button>
      )}
      <button onClick={handleFullscreen} className={btnClass} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        {isFullscreen ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="6,2 6,6 2,6" />
            <polyline points="10,2 10,6 14,6" />
            <polyline points="6,14 6,10 2,10" />
            <polyline points="10,14 10,10 14,10" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="2,6 2,2 6,2" />
            <polyline points="14,6 14,2 10,2" />
            <polyline points="2,10 2,14 6,14" />
            <polyline points="14,10 14,14 10,14" />
          </svg>
        )}
      </button>
    </div>
  );
}

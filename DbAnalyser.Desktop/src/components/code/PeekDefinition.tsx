import { useRef, useEffect } from 'react';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { ResolvedObject } from './sqlIdentifierResolver';

interface PeekDefinitionProps {
  object: ResolvedObject;
  coords: { x: number; y: number };
  onClose: () => void;
  onOpenFull: (obj: ResolvedObject) => void;
}

export function PeekDefinition({ object, coords, onClose, onOpenFull }: PeekDefinitionProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    // Delay adding click listener to avoid immediate close from the Alt+Click that opened this
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 100);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
      clearTimeout(timer);
    };
  }, [onClose]);

  // Position the panel near the click, but keep it on screen
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(coords.x, window.innerWidth - 520),
    top: Math.min(coords.y + 5, window.innerHeight - 350),
    zIndex: 100,
  };

  const color = OBJECT_TYPE_COLORS[object.objectType] ?? '#666';
  const lines = object.definition.split('\n');
  const previewLines = lines.slice(0, 20);

  return (
    <div ref={ref} style={style} className="w-[500px] bg-bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium text-text-primary truncate">{object.fullName}</span>
        <span className="text-[10px] text-text-muted">{object.objectType}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => { onOpenFull(object); onClose(); }}
            className="text-[10px] text-accent hover:text-accent-hover transition-colors"
          >
            Open Full &rarr;
          </button>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-sm transition-colors"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Code preview */}
      <div className="overflow-auto max-h-[280px]">
        <pre className="px-3 py-2 text-[11px] font-mono text-text-secondary leading-relaxed whitespace-pre select-text">
          {previewLines.map((line, i) => (
            <div key={i} className="flex">
              <span className="w-8 text-right pr-3 text-text-muted select-none flex-shrink-0">{i + 1}</span>
              <span>{line}</span>
            </div>
          ))}
          {lines.length > 20 && (
            <div className="text-text-muted text-center py-1">... {lines.length - 20} more lines</div>
          )}
        </pre>
      </div>

      {/* Footer hints */}
      <div className="px-3 py-1 border-t border-border text-[9px] text-text-muted">
        Esc to close · Click "Open Full" or F12 to navigate
      </div>
    </div>
  );
}

import { useEffect } from 'react';

interface Shortcut {
  keys: string;
  description: string;
}

const SECTIONS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: 'Query Editor',
    shortcuts: [
      { keys: 'Ctrl+Enter', description: 'Execute query' },
      { keys: 'Ctrl+D', description: 'Execute current statement' },
      { keys: 'Ctrl+S', description: 'Save query' },
      { keys: 'Ctrl+L', description: 'Clear results' },
    ],
  },
  {
    title: 'Code Editor',
    shortcuts: [
      { keys: 'Ctrl+Click', description: 'Go to definition' },
      { keys: 'F12', description: 'Go to definition' },
      { keys: 'Ctrl+F', description: 'Find in editor' },
      { keys: 'Ctrl+H', description: 'Find and replace' },
    ],
  },
  {
    title: 'Global',
    shortcuts: [
      { keys: 'Ctrl+K', description: 'Quick search' },
      { keys: 'F1', description: 'Keyboard shortcuts' },
      { keys: 'Escape', description: 'Close panel / dialog' },
    ],
  },
];

interface ShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsPanel({ open, onClose }: ShortcutsPanelProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="bg-bg-primary border border-border rounded-xl shadow-2xl w-[480px] max-h-[70vh] overflow-y-auto pointer-events-auto">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Keyboard Shortcuts</h2>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">&times;</button>
          </div>
          <div className="p-5 space-y-5">
            {SECTIONS.map((section) => (
              <div key={section.title}>
                <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">{section.title}</h3>
                <div className="space-y-1">
                  {section.shortcuts.map((s) => (
                    <div key={s.keys + s.description} className="flex items-center justify-between py-1">
                      <span className="text-xs text-text-secondary">{s.description}</span>
                      <kbd className="px-2 py-0.5 text-[11px] font-mono bg-bg-secondary border border-border rounded text-text-primary">
                        {s.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

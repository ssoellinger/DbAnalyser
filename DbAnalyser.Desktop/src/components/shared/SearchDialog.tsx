import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../hooks/useStore';
import { OBJECT_TYPE_COLORS } from '../../api/types';

interface SearchItem {
  name: string;
  type: string;
  page: string;
}

export function SearchDialog() {
  const open = useStore((s) => s.searchOpen);
  const toggleSearch = useStore((s) => s.toggleSearch);
  const result = useStore((s) => s.result);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
      }
      if (e.key === 'Escape' && open) {
        toggleSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, toggleSearch]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const allItems = useMemo<SearchItem[]>(() => {
    if (!result) return [];
    const items: SearchItem[] = [];

    result.schema?.tables.forEach((t) =>
      items.push({ name: t.fullName, type: 'Table', page: '/schema' })
    );
    result.schema?.views.forEach((v) =>
      items.push({ name: v.fullName, type: 'View', page: '/schema' })
    );
    result.schema?.storedProcedures.forEach((p) =>
      items.push({ name: p.fullName, type: 'Procedure', page: '/schema' })
    );
    result.schema?.functions.forEach((f) =>
      items.push({ name: f.fullName, type: 'Function', page: '/schema' })
    );
    result.schema?.triggers.forEach((t) =>
      items.push({ name: t.fullName, type: 'Trigger', page: '/schema' })
    );
    result.schema?.synonyms.forEach((s) =>
      items.push({ name: s.fullName, type: 'Synonym', page: '/schema' })
    );

    return items;
  }, [result]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 20);
    const q = query.toLowerCase();
    return allItems.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 20);
  }, [allItems, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60" onClick={toggleSearch}>
      <div
        className="w-full max-w-lg bg-bg-card border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search objects..."
          className="w-full px-4 py-3 bg-transparent border-b border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <div className="max-h-80 overflow-y-auto">
          {filtered.map((item, i) => (
            <button
              key={i}
              onClick={() => {
                navigate(item.page);
                toggleSearch();
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-hover transition-colors"
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: OBJECT_TYPE_COLORS[item.type] ?? '#666' }}
              />
              <span className="text-sm text-text-primary truncate">{item.name}</span>
              <span className="ml-auto text-xs text-text-muted">{item.type}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-sm text-text-muted text-center">No results found</p>
          )}
        </div>
      </div>
    </div>
  );
}

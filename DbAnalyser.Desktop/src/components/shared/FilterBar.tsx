interface FilterItem {
  key: string;
  label: string;
  count: number;
  color: string;
}

interface FilterBarProps {
  label: string;
  items: FilterItem[];
  active: Set<string>;
  onToggle: (key: string) => void;
}

export function FilterBar({ label, items, active, onToggle }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-text-muted">{label}:</span>
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onToggle(item.key)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-all ${
            active.has(item.key)
              ? 'border-current opacity-100'
              : 'border-border opacity-40 hover:opacity-60'
          }`}
          style={{ color: item.color }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label} ({item.count})
        </button>
      ))}
    </div>
  );
}

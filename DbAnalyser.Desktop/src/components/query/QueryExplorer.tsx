import { useMemo, useState, useEffect, useRef } from 'react';
import { useStore } from '../../hooks/useStore';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { TableInfo, ViewInfo, ColumnInfo } from '../../api/types';
import { formatColumnType } from '../shared/formatColumnType';
import { generateTableDdl } from '../code/tableDdlGenerator';
import {
  generateSelectTop, generateSelectCount,
  generateInsertTemplate, generateColumnList, generateTableRef,
} from './queryHelpers';

interface QueryExplorerProps {
  onInsertText: (text: string, database?: string) => void;
}

interface TreeItem {
  fullName: string;
  label: string;
  schemaName: string;
  type: 'Table' | 'View';
  columns: ColumnInfo[];
  tableInfo: TableInfo; // for DDL generation
  databaseName?: string;
}

// ── Context menu ──

interface ContextMenuState {
  x: number;
  y: number;
  item: TreeItem;
}

function ContextMenu({ menu, onAction, onClose }: {
  menu: ContextMenuState;
  onAction: (text: string, database?: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  const db = menu.item.databaseName;
  const actions = [
    { label: 'SELECT TOP 1000', fn: () => onAction(generateSelectTop(menu.item.tableInfo), db) },
    { label: 'SELECT COUNT(*)', fn: () => onAction(generateSelectCount(menu.item.tableInfo), db) },
    { label: 'INSERT template', fn: () => onAction(generateInsertTemplate(menu.item.tableInfo), db) },
    { label: 'Column list', fn: () => onAction(generateColumnList(menu.item.tableInfo)) },
    { label: 'Script as CREATE', fn: () => onAction(generateTableDdl(menu.item.tableInfo)) },
    { label: 'Insert table name', fn: () => onAction(generateTableRef(menu.item.tableInfo)) },
  ];

  return (
    <div
      ref={ref}
      className="fixed bg-bg-secondary border border-border rounded shadow-xl z-50 py-1 min-w-[160px]"
      style={{ left: menu.x, top: menu.y }}
    >
      <div className="px-3 py-1 text-[10px] text-text-muted border-b border-border/50 truncate">
        {menu.item.fullName}
      </div>
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => { a.fn(); onClose(); }}
          className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ── Main component ──

export function QueryExplorer({ onInsertText }: QueryExplorerProps) {
  const schema = useStore((s) => s.result?.schema);
  const isServerMode = useStore((s) => s.isServerMode);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Build tree items
  const items = useMemo(() => {
    if (!schema) return [];
    const list: TreeItem[] = [];

    for (const t of schema.tables) {
      list.push({
        fullName: t.fullName,
        label: t.tableName,
        schemaName: t.schemaName,
        type: 'Table',
        columns: t.columns,
        tableInfo: t,
        databaseName: t.databaseName,
      });
    }
    for (const v of schema.views) {
      const tableEquiv: TableInfo = {
        schemaName: v.schemaName,
        tableName: v.viewName,
        fullName: v.fullName,
        columns: v.columns,
        indexes: [],
        foreignKeys: [],
        databaseName: v.databaseName,
      };
      list.push({
        fullName: v.fullName,
        label: v.viewName,
        schemaName: v.schemaName,
        type: 'View',
        columns: v.columns,
        tableInfo: tableEquiv,
        databaseName: v.databaseName,
      });
    }

    return list.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [schema]);

  // Filter
  const filtered = useMemo(() => {
    if (!filter.trim()) return items;
    const q = filter.toLowerCase();
    return items.filter((i) => i.fullName.toLowerCase().includes(q) || i.label.toLowerCase().includes(q));
  }, [items, filter]);

  // Group by type (and database in server mode)
  const groups = useMemo(() => {
    if (isServerMode) {
      const byDb = new Map<string, TreeItem[]>();
      for (const item of filtered) {
        const db = item.databaseName ?? 'Unknown';
        if (!byDb.has(db)) byDb.set(db, []);
        byDb.get(db)!.push(item);
      }
      return byDb;
    }
    // Single DB: group by type
    const byType = new Map<string, TreeItem[]>();
    byType.set('Tables', filtered.filter((i) => i.type === 'Table'));
    byType.set('Views', filtered.filter((i) => i.type === 'View'));
    return byType;
  }, [filtered, isServerMode]);

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleItemClick(item: TreeItem) {
    onInsertText(generateTableRef(item.tableInfo));
  }

  function handleContextMenu(e: React.MouseEvent, item: TreeItem) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }

  function handleColumnClick(col: ColumnInfo) {
    onInsertText(`[${col.name}]`);
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-r border-border">
      {/* Header */}
      <div className="px-2 py-2 border-b border-border">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter..."
          className="w-full bg-bg-primary border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {Array.from(groups.entries()).map(([groupName, groupItems]) => {
          if (groupItems.length === 0) return null;
          const isGroupCollapsed = collapsed[groupName];

          return (
            <div key={groupName}>
              <button
                onClick={() => toggleGroup(groupName)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <span className="text-[9px] text-text-muted w-3">{isGroupCollapsed ? '\u25B8' : '\u25BE'}</span>
                <span className="font-medium">{groupName}</span>
                <span className="ml-auto text-[9px] text-text-muted">{groupItems.length}</span>
              </button>

              {!isGroupCollapsed && groupItems.map((item) => {
                const color = OBJECT_TYPE_COLORS[item.type] ?? '#666';
                const isExpanded = expandedTable === item.fullName;

                return (
                  <div key={item.fullName}>
                    <div
                      className="flex items-center gap-1.5 px-2 py-0.5 ml-3 text-[11px] cursor-pointer hover:bg-bg-hover transition-colors group"
                      onClick={() => handleItemClick(item)}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedTable(isExpanded ? null : item.fullName); }}
                        className="text-[9px] text-text-muted w-3 flex-shrink-0"
                      >
                        {isExpanded ? '\u25BE' : '\u25B8'}
                      </button>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-text-secondary group-hover:text-text-primary truncate">{item.label}</span>
                      <span className="ml-auto text-[9px] text-text-muted opacity-0 group-hover:opacity-100">
                        {item.type === 'View' ? 'V' : ''}
                      </span>
                    </div>

                    {/* Expanded columns */}
                    {isExpanded && (
                      <div className="ml-8 border-l border-border/40 pl-1">
                        {item.columns.map((col) => (
                          <button
                            key={col.name}
                            onClick={() => handleColumnClick(col)}
                            className="w-full flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-secondary hover:bg-bg-hover/50 transition-colors"
                            title={`${col.name} ${formatColumnType(col)}${col.isPrimaryKey ? ' (PK)' : ''}${col.isNullable ? ' NULL' : ' NOT NULL'}`}
                          >
                            {col.isPrimaryKey && <span className="text-[7px] px-0.5 rounded bg-accent/20 text-accent">PK</span>}
                            <span className="truncate">{col.name}</span>
                            <span className="ml-auto text-[9px] text-text-muted">{formatColumnType(col)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-text-muted text-center">
            {filter ? 'No matching objects' : 'No schema loaded'}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-2 py-1 border-t border-border text-[9px] text-text-muted">
        Right-click for actions
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onAction={(text, db) => { onInsertText(text, db); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

import { useMemo, useState, useEffect, useRef } from 'react';
import { useStore } from '../../hooks/useStore';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { TableInfo, ViewInfo, ColumnInfo } from '../../api/types';
import { formatColumnType } from '../shared/formatColumnType';
import { generateTableDdl, generateJobDdl, generateSequenceDdl, generateUdtDdl, generateSynonymDdl } from '../code/tableDdlGenerator';
import {
  generateSelectTop, generateSelectCount,
  generateInsertTemplate, generateColumnList, generateTableRef,
} from './queryHelpers';

interface QueryExplorerProps {
  onInsertText: (text: string, database?: string) => void;
  onOpenInNewTab: (text: string, database?: string) => void;
}

type ObjectKind = 'Table' | 'View' | 'Procedure' | 'Function' | 'Trigger' | 'Synonym' | 'Sequence' | 'Type' | 'Job';

interface TreeItem {
  fullName: string;
  label: string;
  schemaName: string;
  type: ObjectKind;
  columns: ColumnInfo[];
  tableInfo?: TableInfo; // for tables/views DDL generation
  definition?: string; // for procs/functions/triggers
  databaseName?: string;
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
    >
      {label}
    </button>
  );
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
  const item = menu.item;
  const isTableLike = item.type === 'Table' || item.type === 'View';
  const isExecutable = item.type === 'Procedure' || item.type === 'Function';
  const ref2 = `[${item.schemaName}].[${item.label}]`;

  return (
    <div
      ref={ref}
      className="fixed bg-bg-secondary border border-border rounded shadow-xl z-50 py-1 min-w-[180px]"
      style={{ left: menu.x, top: menu.y }}
    >
      <div className="px-3 py-1 text-[10px] text-text-muted border-b border-border/50 truncate">
        {item.fullName}
      </div>
      {isTableLike && item.tableInfo && (
        <>
          <MenuItem label="SELECT TOP 1000" onClick={() => { onAction(generateSelectTop(item.tableInfo!), db); onClose(); }} />
          <MenuItem label="SELECT COUNT(*)" onClick={() => { onAction(generateSelectCount(item.tableInfo!), db); onClose(); }} />
          <MenuItem label="INSERT template" onClick={() => { onAction(generateInsertTemplate(item.tableInfo!), db); onClose(); }} />
          <MenuItem label="Column list" onClick={() => { onAction(generateColumnList(item.tableInfo!)); onClose(); }} />
          <MenuItem label="Script as CREATE" onClick={() => { onAction(generateTableDdl(item.tableInfo!)); onClose(); }} />
        </>
      )}
      {isExecutable && (
        <>
          <MenuItem label="EXEC" onClick={() => { onAction(`EXEC ${ref2};\n`, db); onClose(); }} />
          <MenuItem label="Script definition" onClick={() => { onAction(item.definition ?? ''); onClose(); }} />
        </>
      )}
      {item.type === 'Trigger' && (
        <MenuItem label="Script definition" onClick={() => { onAction(item.definition ?? ''); onClose(); }} />
      )}
      {item.type === 'Job' && (
        <>
          <MenuItem label="EXEC (sp_start_job)" onClick={() => { onAction(`EXEC msdb.dbo.sp_start_job @job_name = '${item.label}';\n`, db); onClose(); }} />
          <MenuItem label="Script definition" onClick={() => { onAction(item.definition ?? ''); onClose(); }} />
        </>
      )}
      {(item.type === 'Synonym' || item.type === 'Sequence' || item.type === 'Type') && (
        <MenuItem label="Script definition" onClick={() => { onAction(item.definition ?? ''); onClose(); }} />
      )}
      <MenuItem label="Insert name" onClick={() => { onAction(ref2); onClose(); }} />
    </div>
  );
}

// ── Main component ──

export function QueryExplorer({ onInsertText, onOpenInNewTab }: QueryExplorerProps) {
  const schema = useStore((s) => s.result?.schema);
  const isServerMode = useStore((s) => s.isServerMode);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [insertMode, setInsertMode] = useState<'cursor' | 'newtab'>('newtab');

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
    for (const p of schema.storedProcedures) {
      list.push({
        fullName: p.fullName,
        label: p.procedureName,
        schemaName: p.schemaName,
        type: 'Procedure',
        columns: [],
        definition: p.definition ?? '',
        databaseName: p.databaseName,
      });
    }
    for (const f of schema.functions) {
      list.push({
        fullName: f.fullName,
        label: f.functionName,
        schemaName: f.schemaName,
        type: 'Function',
        columns: [],
        definition: f.definition ?? '',
        databaseName: f.databaseName,
      });
    }
    for (const t of schema.triggers) {
      list.push({
        fullName: t.fullName,
        label: t.triggerName,
        schemaName: t.schemaName,
        type: 'Trigger',
        columns: [],
        definition: t.definition ?? '',
        databaseName: t.databaseName,
      });
    }
    for (const s of schema.synonyms) {
      list.push({
        fullName: s.fullName,
        label: s.synonymName,
        schemaName: s.schemaName,
        type: 'Synonym',
        columns: [],
        definition: generateSynonymDdl(s),
        databaseName: s.databaseName,
      });
    }
    for (const seq of schema.sequences) {
      list.push({
        fullName: seq.fullName,
        label: seq.sequenceName,
        schemaName: seq.schemaName,
        type: 'Sequence',
        columns: [],
        definition: generateSequenceDdl(seq),
        databaseName: seq.databaseName,
      });
    }
    for (const udt of schema.userDefinedTypes) {
      list.push({
        fullName: udt.fullName,
        label: udt.typeName,
        schemaName: udt.schemaName,
        type: 'Type',
        columns: [],
        definition: generateUdtDdl(udt),
        databaseName: udt.databaseName,
      });
    }
    for (const j of schema.jobs) {
      list.push({
        fullName: j.jobName,
        label: j.jobName,
        schemaName: '',
        type: 'Job',
        columns: [],
        definition: generateJobDdl(j),
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

  const TYPE_ORDER: [string, ObjectKind][] = [
    ['Tables', 'Table'], ['Views', 'View'], ['Procedures', 'Procedure'],
    ['Functions', 'Function'], ['Triggers', 'Trigger'], ['Synonyms', 'Synonym'],
    ['Sequences', 'Sequence'], ['Types', 'Type'], ['Jobs', 'Job'],
  ];

  function groupByType(items: TreeItem[]): Map<string, TreeItem[]> {
    const byType = new Map<string, TreeItem[]>();
    for (const [label, kind] of TYPE_ORDER) {
      const group = items.filter((i) => i.type === kind);
      if (group.length > 0) byType.set(label, group);
    }
    return byType;
  }

  // In server mode: databases → type groups. In single DB: just type groups.
  const databases = useMemo(() => {
    if (!isServerMode) return null;
    const byDb = new Map<string, TreeItem[]>();
    for (const item of filtered) {
      const db = item.databaseName ?? 'Unknown';
      if (!byDb.has(db)) byDb.set(db, []);
      byDb.get(db)!.push(item);
    }
    return byDb;
  }, [filtered, isServerMode]);

  const typeGroups = useMemo(() => groupByType(filtered), [filtered]);

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleItemClick(item: TreeItem) {
    const ref = `[${item.schemaName}].[${item.label}]`;
    if (item.type === 'Table' || item.type === 'View') {
      if (insertMode === 'newtab') onOpenInNewTab(`SELECT TOP 1000 *\nFROM ${ref};\n`, item.databaseName);
      else onInsertText(ref);
    } else if (item.type === 'Procedure' || item.type === 'Function') {
      if (insertMode === 'newtab') onOpenInNewTab(`EXEC ${ref};\n`, item.databaseName);
      else onInsertText(`EXEC ${ref}`);
    } else {
      onInsertText(ref);
    }
  }

  function handleContextMenu(e: React.MouseEvent, item: TreeItem) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }

  function handleColumnClick(col: ColumnInfo) {
    onInsertText(`[${col.name}]`);
  }

  const GROUP_ICONS: Record<string, string> = {
    Tables: '\u229F', Views: '\u22A1', Procedures: '\u229E',
    Functions: '\u0192', Triggers: '\u26A1', Synonyms: '\u2194',
    Sequences: '\u2116', Types: '\u2B25', Jobs: '\u23F1',
  };

  function renderTypeGroups(groups: Map<string, TreeItem[]>, indent: number, keyPrefix: string) {
    return Array.from(groups.entries()).map(([typeName, items]) => {
      const collapseKey = `${keyPrefix}${typeName}`;
      const isCollapsed = collapsed[collapseKey];
      const color = OBJECT_TYPE_COLORS[items[0]?.type] ?? '#666';

      return (
        <div key={collapseKey}>
          <button
            onClick={() => toggleGroup(collapseKey)}
            className="w-full flex items-center gap-1.5 py-1 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ paddingLeft: indent + 8 }}
          >
            <span className="text-[9px] text-text-muted w-3">{isCollapsed ? '\u25B8' : '\u25BE'}</span>
            <span style={{ color }}>{GROUP_ICONS[typeName] ?? '\u25CF'}</span>
            <span className="font-medium">{typeName}</span>
            <span className="ml-auto pr-2 text-[9px] text-text-muted">{items.length}</span>
          </button>
          {!isCollapsed && items.map((item) => renderItem(item, indent + 16))}
        </div>
      );
    });
  }

  function renderItem(item: TreeItem, indent: number) {
    const color = OBJECT_TYPE_COLORS[item.type] ?? '#666';
    const isExpanded = expandedTable === item.fullName;
    const hasColumns = item.columns.length > 0;

    return (
      <div key={item.fullName}>
        <div
          className="flex items-center gap-1.5 py-0.5 text-[11px] cursor-pointer hover:bg-bg-hover transition-colors group"
          style={{ paddingLeft: indent + 8 }}
          onClick={() => handleItemClick(item)}
          onContextMenu={(e) => handleContextMenu(e, item)}
        >
          {hasColumns ? (
            <button
              onClick={(e) => { e.stopPropagation(); setExpandedTable(isExpanded ? null : item.fullName); }}
              className="text-[9px] text-text-muted w-3 flex-shrink-0"
            >
              {isExpanded ? '\u25BE' : '\u25B8'}
            </button>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <span className="text-text-secondary group-hover:text-text-primary truncate">{item.label}</span>
        </div>

        {hasColumns && isExpanded && (
          <div style={{ marginLeft: indent + 24 }} className="border-l border-border/40 pl-1">
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
        {isServerMode && databases ? (
          // Server mode: Database → Type → Items
          <>
            {Array.from(databases.entries()).map(([dbName, dbItems]) => {
              const isDbCollapsed = collapsed[`db:${dbName}`];
              return (
                <div key={dbName}>
                  <button
                    onClick={() => toggleGroup(`db:${dbName}`)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-primary font-medium hover:bg-bg-hover transition-colors"
                  >
                    <span className="text-[9px] text-text-muted w-3">{isDbCollapsed ? '\u25B8' : '\u25BE'}</span>
                    <span className="text-accent">&#x229B;</span>
                    <span>{dbName}</span>
                    <span className="ml-auto text-[9px] text-text-muted">{dbItems.length}</span>
                  </button>
                  {!isDbCollapsed && renderTypeGroups(groupByType(dbItems), 12, `db:${dbName}:`)}
                </div>
              );
            })}
            {/* Server-level objects (Jobs) */}
            {renderTypeGroups(groupByType(filtered.filter((i) => !i.databaseName)), 0, 'server:')}
          </>
        ) : (
          // Single DB: Type → Items
          renderTypeGroups(typeGroups, 0, '')
        )}

        {filtered.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-text-muted text-center">
            {filter ? 'No matching objects' : 'No schema loaded'}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-2 py-1.5 border-t border-border flex items-center gap-1">
        <button
          onClick={() => setInsertMode('cursor')}
          className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${insertMode === 'cursor' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          title="Insert SQL at cursor position"
        >
          At cursor
        </button>
        <button
          onClick={() => setInsertMode('newtab')}
          className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${insertMode === 'newtab' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          title="Open SQL in a new query tab"
        >
          New tab
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onAction={(text, db) => {
            if (insertMode === 'newtab') onOpenInNewTab(text, db);
            else onInsertText(text, db);
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

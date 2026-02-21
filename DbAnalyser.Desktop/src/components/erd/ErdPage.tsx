import { useState, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type EdgeProps,
  BaseEdge,
  getBezierPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../../hooks/useStore';
import { useAnalyzer } from '../../hooks/useAnalyzer';
import { FilterBar } from '../shared/FilterBar';
import { GraphControls } from '../shared/GraphControls';
import { AnalyzerLoader } from '../shared/AnalyzerLoader';
import { getLayoutedElements } from '../../hooks/useDagreLayout';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { TableInfo, ColumnInfo } from '../../api/types';
import { getDatabaseColor } from '../dashboard/DashboardPage';

// ── Custom Table Node ───────────────────────────────────────────────────────

function TableNode({ data }: { data: { table: TableInfo; color: string } }) {
  const { table, color } = data;
  const pkColumns = table.columns.filter((c) => c.isPrimaryKey);
  const fkColumnNames = new Set(table.foreignKeys.map((fk) => fk.fromColumn));
  const nonPkColumns = table.columns.filter((c) => !c.isPrimaryKey);

  return (
    <div className="bg-bg-card border border-border rounded-md shadow-lg min-w-[180px] text-[11px] overflow-hidden relative">
      <Handle type="target" position={Position.Top} className="!bg-accent !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2 !border-0" />
      <Handle type="target" position={Position.Left} id="left-target" className="!bg-accent !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right} id="right-source" className="!bg-accent !w-2 !h-2 !border-0" />
      <div
        className="px-3 py-2 font-semibold text-white text-xs"
        style={{ backgroundColor: color }}
      >
        {table.fullName}
      </div>
      <div className="divide-y divide-border/50">
        {pkColumns.map((col) => (
          <ColumnRow key={col.name} col={col} isPk isFk={fkColumnNames.has(col.name)} />
        ))}
        {pkColumns.length > 0 && nonPkColumns.length > 0 && (
          <div className="border-t border-border" />
        )}
        {nonPkColumns.slice(0, 15).map((col) => (
          <ColumnRow key={col.name} col={col} isPk={false} isFk={fkColumnNames.has(col.name)} />
        ))}
        {nonPkColumns.length > 15 && (
          <div className="px-3 py-1 text-text-muted text-center">
            ... {nonPkColumns.length - 15} more
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnRow({ col, isPk, isFk }: { col: ColumnInfo; isPk: boolean; isFk: boolean }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 hover:bg-bg-hover/50">
      <span className="flex gap-0.5 w-8 flex-shrink-0">
        {isPk && <span className="text-[9px] px-0.5 rounded bg-accent/20 text-accent">PK</span>}
        {isFk && <span className="text-[9px] px-0.5 rounded bg-node-view/20 text-node-view">FK</span>}
      </span>
      <span className={`flex-1 truncate ${isPk ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
        {col.name}
      </span>
      <span className="text-text-muted text-[10px] flex-shrink-0">{col.dataType}</span>
      {!col.isNullable && <span className="text-severity-warning text-[9px]">*</span>}
    </div>
  );
}

// ── Compact Object Node ─────────────────────────────────────────────────────

function CompactNode({ data }: { data: { label: string; type: string; detail?: string; color: string } }) {
  const { label, type, detail, color } = data;
  return (
    <div className="bg-bg-card border border-border rounded-md shadow-md text-[11px] overflow-hidden min-w-[140px]">
      <Handle type="target" position={Position.Top} className="!bg-accent !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2 !border-0" />
      <Handle type="target" position={Position.Left} id="left-target" className="!bg-accent !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right} id="right-source" className="!bg-accent !w-2 !h-2 !border-0" />
      <div className="px-3 py-1.5 font-semibold text-white text-xs flex items-center gap-2" style={{ backgroundColor: color }}>
        <span className="opacity-70 text-[9px] uppercase">{type}</span>
        <span className="truncate">{label}</span>
      </div>
      {detail && (
        <div className="px-3 py-1 text-text-muted text-[10px] truncate">{detail}</div>
      )}
    </div>
  );
}

// ── Crow's foot edge ────────────────────────────────────────────────────────

function CrowsFootEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, style, markerEnd } = props;
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
  });

  return <BaseEdge path={edgePath} style={style} markerEnd={markerEnd} />;
}

const nodeTypes = { tableNode: TableNode, compactNode: CompactNode };
const edgeTypes = { crowsfoot: CrowsFootEdge };

// ── ERD Graph ───────────────────────────────────────────────────────────────

function ErdGraphInner() {
  const result = useStore((s) => s.result)!;
  const schema = result.schema!;
  const rels = result.relationships;
  const isServerMode = useStore((s) => s.isServerMode);

  // Database filters (server mode only)
  const databaseFilters = useMemo(() => {
    if (!isServerMode || !result.databases?.length) return [];
    return result.databases.map((db) => ({
      key: db,
      label: db,
      count: schema.tables.filter((t) => t.databaseName === db).length +
             schema.views.filter((v) => v.databaseName === db).length,
      color: getDatabaseColor(db),
    }));
  }, [isServerMode, result.databases, schema]);

  const [activeDatabases, setActiveDatabases] = useState<Set<string>>(
    () => new Set(result.databases ?? [])
  );

  const objectTypes = useMemo(() => {
    const items = [
      { key: 'table', label: 'Tables', count: schema.tables.length, color: OBJECT_TYPE_COLORS.Table },
    ];
    if (schema.views.length > 0)
      items.push({ key: 'view', label: 'Views', count: schema.views.length, color: OBJECT_TYPE_COLORS.View });
    if (schema.storedProcedures.length > 0)
      items.push({ key: 'procedure', label: 'Procedures', count: schema.storedProcedures.length, color: OBJECT_TYPE_COLORS.Procedure });
    if (schema.functions.length > 0)
      items.push({ key: 'function', label: 'Functions', count: schema.functions.length, color: OBJECT_TYPE_COLORS.Function });
    if (schema.triggers.length > 0)
      items.push({ key: 'trigger', label: 'Triggers', count: schema.triggers.length, color: OBJECT_TYPE_COLORS.Trigger });
    if (schema.synonyms.length > 0)
      items.push({ key: 'synonym', label: 'Synonyms', count: schema.synonyms.length, color: OBJECT_TYPE_COLORS.Synonym });
    return items;
  }, [schema]);

  const [activeTypes, setActiveTypes] = useState(() => new Set(['table', 'view']));

  // Helper: get node color based on mode
  const getColor = useCallback((objectType: string, dbName?: string) => {
    if (isServerMode && dbName) return getDatabaseColor(dbName);
    return OBJECT_TYPE_COLORS[objectType] ?? '#666';
  }, [isServerMode]);

  // Helper: filter by active databases in server mode
  const dbFilter = useCallback((dbName?: string) => {
    if (!isServerMode) return true;
    return dbName ? activeDatabases.has(dbName) : true;
  }, [isServerMode, activeDatabases]);

  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    if (activeTypes.has('table')) {
      schema.tables.filter((t) => dbFilter(t.databaseName)).forEach((table) => {
        nodes.push({
          id: table.fullName,
          type: 'tableNode',
          position: { x: 0, y: 0 },
          data: { table, color: getColor('Table', table.databaseName) },
          width: 240,
          height: 36 + Math.min(table.columns.length, 16) * 24,
        });
      });
    }

    if (activeTypes.has('view')) {
      schema.views.filter((v) => dbFilter(v.databaseName)).forEach((view) => {
        const tableEquiv: TableInfo = {
          schemaName: view.schemaName,
          tableName: view.viewName,
          databaseName: view.databaseName,
          fullName: view.fullName,
          columns: view.columns,
          indexes: [],
          foreignKeys: [],
        };
        nodes.push({
          id: view.fullName,
          type: 'tableNode',
          position: { x: 0, y: 0 },
          data: { table: tableEquiv, color: getColor('View', view.databaseName) },
          width: 240,
          height: 36 + Math.min(view.columns.length, 16) * 24,
        });
      });
    }

    if (activeTypes.has('procedure')) {
      schema.storedProcedures.filter((sp) => dbFilter(sp.databaseName)).forEach((sp) => {
        const label = sp.fullName.split('.').pop() ?? sp.fullName;
        nodes.push({
          id: sp.fullName,
          type: 'compactNode',
          position: { x: 0, y: 0 },
          data: { label, type: 'SP', color: getColor('Procedure', sp.databaseName) },
          width: 180,
          height: 32,
        });
      });
    }

    if (activeTypes.has('function')) {
      schema.functions.filter((fn) => dbFilter(fn.databaseName)).forEach((fn) => {
        const label = fn.fullName.split('.').pop() ?? fn.fullName;
        nodes.push({
          id: fn.fullName,
          type: 'compactNode',
          position: { x: 0, y: 0 },
          data: { label, type: 'FN', detail: fn.functionType, color: getColor('Function', fn.databaseName) },
          width: 180,
          height: 46,
        });
      });
    }

    if (activeTypes.has('trigger')) {
      schema.triggers.filter((t) => dbFilter(t.databaseName)).forEach((trg) => {
        const label = trg.fullName.split('.').pop() ?? trg.fullName;
        nodes.push({
          id: trg.fullName,
          type: 'compactNode',
          position: { x: 0, y: 0 },
          data: { label, type: 'TR', detail: `on ${trg.parentFullName}`, color: getColor('Trigger', trg.databaseName) },
          width: 180,
          height: 46,
        });
      });
    }

    if (activeTypes.has('synonym')) {
      schema.synonyms.filter((s) => dbFilter(s.databaseName)).forEach((syn) => {
        const label = syn.fullName.split('.').pop() ?? syn.fullName;
        nodes.push({
          id: syn.fullName,
          type: 'compactNode',
          position: { x: 0, y: 0 },
          data: { label, type: 'SYN', detail: `→ ${syn.baseObjectName}`, color: getColor('Synonym', syn.databaseName) },
          width: 180,
          height: 46,
        });
      });
    }

    const nodeSet = new Set(nodes.map((n) => n.id));

    // FK edges (solid)
    if (rels) {
      rels.explicitRelationships.forEach((fk, i) => {
        const from = fk.fromDatabase
          ? `${fk.fromDatabase}.${fk.fromSchema}.${fk.fromTable}`
          : `${fk.fromSchema}.${fk.fromTable}`;
        const to = fk.toDatabase
          ? `${fk.toDatabase}.${fk.toSchema}.${fk.toTable}`
          : `${fk.toSchema}.${fk.toTable}`;
        if (nodeSet.has(from) && nodeSet.has(to)) {
          edges.push({
            id: `erd-fk-${i}`,
            source: from,
            target: to,
            type: 'crowsfoot',
            style: { stroke: '#4fc3f7', strokeWidth: 1.5 },
            label: fk.name.length > 30 ? '' : fk.name,
            labelStyle: { fontSize: 9, fill: '#888' },
          });
        }
      });

      // Object dependency edges (dashed)
      rels.viewDependencies
        .filter((d) => !d.isCrossDatabase)
        .forEach((d, i) => {
          const from = d.fromFullName ?? `${d.fromSchema}.${d.fromName}`;
          const to = d.toFullName;
          if (nodeSet.has(from) && nodeSet.has(to)) {
            edges.push({
              id: `erd-dep-${i}`,
              source: from,
              target: to,
              style: { stroke: OBJECT_TYPE_COLORS[d.fromType] ?? '#666', strokeDasharray: '5 3', strokeWidth: 1 },
            });
          }
        });

      // Implicit FK edges (dotted)
      rels.implicitRelationships
        .filter((r) => r.confidence >= 0.7)
        .forEach((r, i) => {
          const from = r.fromDatabase
            ? `${r.fromDatabase}.${r.fromSchema}.${r.fromTable}`
            : `${r.fromSchema}.${r.fromTable}`;
          const to = r.toDatabase
            ? `${r.toDatabase}.${r.toSchema}.${r.toTable}`
            : `${r.toSchema}.${r.toTable}`;
          if (nodeSet.has(from) && nodeSet.has(to)) {
            edges.push({
              id: `erd-impl-${i}`,
              source: from,
              target: to,
              style: { stroke: '#78909c', strokeDasharray: '2 4', strokeWidth: 1 },
            });
          }
        });
    }

    // Trigger → parent table edges
    if (activeTypes.has('trigger')) {
      schema.triggers.forEach((trg, i) => {
        if (nodeSet.has(trg.fullName) && nodeSet.has(trg.parentFullName)) {
          edges.push({
            id: `erd-trg-${i}`,
            source: trg.fullName,
            target: trg.parentFullName,
            style: { stroke: OBJECT_TYPE_COLORS.Trigger, strokeDasharray: '3 3', strokeWidth: 1 },
          });
        }
      });
    }

    const laid = getLayoutedElements(nodes, edges, {
      rankSep: 200,
      nodeSep: 40,
      nodeWidth: 240,
      nodeHeight: 250,
    });
    return { initialNodes: laid.nodes, initialEdges: laid.edges };
  }, [schema, rels, activeTypes, getColor, dbFilter]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleAutoLayout = useCallback(() => {
    const laid = getLayoutedElements(nodes, edges, {
      rankSep: 200,
      nodeSep: 40,
      nodeWidth: 240,
      nodeHeight: 250,
    });
    setNodes(laid.nodes);
  }, [nodes, edges, setNodes]);

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-104px)] overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-lg font-semibold text-text-primary">Entity Relationship Diagram</h2>
        <span className="text-xs text-text-muted">{nodes.length} objects</span>
      </div>

      <div className="shrink-0 flex items-center gap-6 flex-wrap">
        {isServerMode && databaseFilters.length > 0 && (
          <>
            <FilterBar
              label="Databases"
              items={databaseFilters}
              active={activeDatabases}
              onToggle={(key) => {
                setActiveDatabases((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key); else next.add(key);
                  return next;
                });
              }}
            />
            <div className="w-px h-4 bg-border" />
          </>
        )}
        <FilterBar
          label="Objects"
          items={objectTypes}
          active={activeTypes}
          onToggle={(key) => {
            setActiveTypes((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key); else next.add(key);
              return next;
            });
          }}
        />
      </div>

      <div className="flex-1 min-h-0 bg-bg-secondary border border-border rounded-lg relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.05 }}
          minZoom={0.05}
          maxZoom={2}
        >
          <Background />
          <GraphControls onAutoLayout={handleAutoLayout} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function ErdPage() {
  const { status, error, progress, refresh } = useAnalyzer('schema');
  const schema = useStore((s) => s.result?.schema);

  return (
    <AnalyzerLoader status={status} error={error} onRefresh={refresh} analyzerName="schema" progress={progress}>
      {schema && schema.tables.length > 0 ? (
        <ReactFlowProvider>
          <ErdGraphInner />
        </ReactFlowProvider>
      ) : (
        <p className="text-text-muted">No schema data available for ERD.</p>
      )}
    </AnalyzerLoader>
  );
}

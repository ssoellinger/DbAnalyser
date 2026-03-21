import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  type Node,
  type Edge,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../../hooks/useStore';
import { getLayoutedElements } from '../../hooks/useDagreLayout';
import { generateTableDdl } from './tableDdlGenerator';
import { OBJECT_TYPE_COLORS } from '../../api/types';
import type { TableInfo, ColumnInfo } from '../../api/types';
import type { ResolvedObject } from './sqlIdentifierResolver';

interface MiniErdProps {
  fullName: string;
  onClose: () => void;
  onNavigate: (obj: ResolvedObject) => void;
}

// Compact table node for the mini ERD
function MiniTableNode({ data }: { data: { table: TableInfo; color: string; isCenter: boolean } }) {
  const { table, color, isCenter } = data;
  const pkColumns = table.columns.filter((c) => c.isPrimaryKey);
  const fkColumnNames = new Set(table.foreignKeys.map((fk) => fk.fromColumn));
  const nonPkColumns = table.columns.filter((c) => !c.isPrimaryKey);
  const maxCols = 8;

  return (
    <div className={`bg-bg-card border rounded-md shadow-lg min-w-[160px] text-[10px] overflow-hidden ${
      isCenter ? 'border-accent border-2' : 'border-border'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-accent !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2 !border-0" />
      <Handle type="target" position={Position.Left} id="left-target" className="!bg-accent !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right} id="right-source" className="!bg-accent !w-2 !h-2 !border-0" />
      <div
        className="px-2.5 py-1.5 font-semibold text-white text-[11px]"
        style={{ backgroundColor: color }}
      >
        {table.fullName}
      </div>
      <div className="divide-y divide-border/50">
        {pkColumns.map((col) => (
          <MiniColumnRow key={col.name} col={col} isPk isFk={fkColumnNames.has(col.name)} />
        ))}
        {pkColumns.length > 0 && nonPkColumns.length > 0 && (
          <div className="border-t border-border" />
        )}
        {nonPkColumns.slice(0, maxCols).map((col) => (
          <MiniColumnRow key={col.name} col={col} isPk={false} isFk={fkColumnNames.has(col.name)} />
        ))}
        {nonPkColumns.length > maxCols && (
          <div className="px-2.5 py-0.5 text-text-muted text-center text-[9px]">
            ... {nonPkColumns.length - maxCols} more
          </div>
        )}
      </div>
    </div>
  );
}

function MiniColumnRow({ col, isPk, isFk }: { col: ColumnInfo; isPk: boolean; isFk: boolean }) {
  return (
    <div className="flex items-center gap-1 px-2.5 py-0.5">
      <span className="flex gap-0.5 w-7 flex-shrink-0">
        {isPk && <span className="text-[8px] px-0.5 rounded bg-accent/20 text-accent">PK</span>}
        {isFk && <span className="text-[8px] px-0.5 rounded bg-node-view/20 text-node-view">FK</span>}
      </span>
      <span className={`flex-1 truncate ${isPk ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
        {col.name}
      </span>
      <span className="text-text-muted text-[9px] flex-shrink-0">{col.dataType}</span>
    </div>
  );
}

const miniNodeTypes = { miniTableNode: MiniTableNode };

function MiniErdInner({ fullName, onClose, onNavigate }: MiniErdProps) {
  const result = useStore((s) => s.result);
  const schema = result?.schema;
  const rels = result?.relationships;

  const { nodes, edges } = useMemo(() => {
    if (!schema || !rels) return { nodes: [] as Node[], edges: [] as Edge[] };

    const centerTable = schema.tables.find((t) => t.fullName === fullName);
    if (!centerTable) return { nodes: [] as Node[], edges: [] as Edge[] };

    // Find all tables connected via FK (1 hop)
    const neighborNames = new Set<string>();
    const fkEdges: { from: string; to: string; label: string; fromCol: string; toCol: string }[] = [];

    for (const fk of rels.explicitRelationships) {
      const fromFull = fk.fromDatabase
        ? `${fk.fromDatabase}.${fk.fromSchema}.${fk.fromTable}`
        : `${fk.fromSchema}.${fk.fromTable}`;
      const toFull = fk.toDatabase
        ? `${fk.toDatabase}.${fk.toSchema}.${fk.toTable}`
        : `${fk.toSchema}.${fk.toTable}`;

      if (fromFull === fullName) {
        neighborNames.add(toFull);
        fkEdges.push({ from: fromFull, to: toFull, label: `${fk.fromColumn} → ${fk.toColumn}`, fromCol: fk.fromColumn, toCol: fk.toColumn });
      } else if (toFull === fullName) {
        neighborNames.add(fromFull);
        fkEdges.push({ from: fromFull, to: toFull, label: `${fk.fromColumn} → ${fk.toColumn}`, fromCol: fk.fromColumn, toCol: fk.toColumn });
      }
    }

    // Also check table's own foreignKeys
    for (const fk of centerTable.foreignKeys) {
      const toFull = fk.toDatabase
        ? `${fk.toDatabase}.${fk.toSchema}.${fk.toTable}`
        : `${fk.toSchema}.${fk.toTable}`;
      neighborNames.add(toFull);
    }

    // Build nodes
    const nodes: Node[] = [];
    const tableMap = new Map(schema.tables.map((t) => [t.fullName, t]));

    // Center node
    nodes.push({
      id: centerTable.fullName,
      type: 'miniTableNode',
      position: { x: 0, y: 0 },
      data: { table: centerTable, color: OBJECT_TYPE_COLORS.Table, isCenter: true },
      width: 220,
      height: 32 + Math.min(centerTable.columns.length, 9) * 20,
    });

    // Neighbor nodes
    for (const name of neighborNames) {
      if (name === fullName) continue;
      const table = tableMap.get(name);
      if (!table) continue;
      nodes.push({
        id: table.fullName,
        type: 'miniTableNode',
        position: { x: 0, y: 0 },
        data: { table, color: OBJECT_TYPE_COLORS.Table, isCenter: false },
        width: 220,
        height: 32 + Math.min(table.columns.length, 9) * 20,
      });
    }

    const nodeSet = new Set(nodes.map((n) => n.id));

    // Build edges
    const edges: Edge[] = [];
    const edgeSeen = new Set<string>();
    for (const fk of fkEdges) {
      if (!nodeSet.has(fk.from) || !nodeSet.has(fk.to)) continue;
      const key = `${fk.from}->${fk.to}:${fk.fromCol}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      edges.push({
        id: `mini-fk-${edges.length}`,
        source: fk.from,
        target: fk.to,
        style: { stroke: '#4fc3f7', strokeWidth: 1.5 },
        label: fk.label,
        labelStyle: { fontSize: 9, fill: '#888' },
      });
    }

    // Also add edges from centerTable.foreignKeys that may not be in explicitRelationships
    for (const fk of centerTable.foreignKeys) {
      const toFull = fk.toDatabase
        ? `${fk.toDatabase}.${fk.toSchema}.${fk.toTable}`
        : `${fk.toSchema}.${fk.toTable}`;
      if (!nodeSet.has(toFull)) continue;
      const key = `${fullName}->${toFull}:${fk.fromColumn}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      edges.push({
        id: `mini-fk-${edges.length}`,
        source: fullName,
        target: toFull,
        style: { stroke: '#4fc3f7', strokeWidth: 1.5 },
        label: `${fk.fromColumn} → ${fk.toColumn}`,
        labelStyle: { fontSize: 9, fill: '#888' },
      });
    }

    // Layout
    const laid = getLayoutedElements(nodes, edges, {
      direction: 'LR',
      rankSep: 120,
      nodeSep: 30,
      nodeWidth: 220,
      nodeHeight: 200,
    });

    return { nodes: laid.nodes, edges: laid.edges };
  }, [fullName, schema, rels]);

  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (!schema) return;
    const table = schema.tables.find((t) => t.fullName === node.id);
    if (table) {
      onNavigate({
        objectType: 'Table',
        fullName: table.fullName,
        label: table.tableName,
        definition: generateTableDdl(table),
      });
      onClose();
    }
  }, [schema, onNavigate, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-bg-primary border border-border rounded-xl shadow-2xl overflow-hidden"
        style={{ width: '80vw', maxWidth: 1000, height: '70vh', maxHeight: 700 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-card">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">FK Graph</span>
            <span className="text-xs text-text-muted">{fullName}</span>
            <span className="text-[10px] text-text-muted">{nodes.length} table{nodes.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted">Double-click a table to open it</span>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary text-lg transition-colors leading-none"
            >
              &times;
            </button>
          </div>
        </div>
        <div className="flex-1" style={{ height: 'calc(100% - 40px)' }}>
          {nodes.length <= 1 ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              No FK relationships found for this table
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={miniNodeTypes}
              onNodeDoubleClick={handleNodeDoubleClick}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.3}
              maxZoom={1.5}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable={false}
            >
              <Background />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
}

export function MiniErd(props: MiniErdProps) {
  return (
    <ReactFlowProvider>
      <MiniErdInner {...props} />
    </ReactFlowProvider>
  );
}

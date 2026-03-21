import type { DatabaseSchema } from '../../api/types';
import { generateTableDdl } from './tableDdlGenerator';

export interface SchemaObject {
  objectType: string;
  fullName: string;
  label: string;
  definition: string;
}

/**
 * Builds a lookup map from fullName (and short name) to schema objects.
 * Reused across CodePage, DmlSummary, ExecutionChainPanel, DependencyMiniView.
 */
export function buildObjectLookup(schema: DatabaseSchema | null): Map<string, SchemaObject> {
  const map = new Map<string, SchemaObject>();
  if (!schema) return map;

  function add(key: string, obj: SchemaObject) {
    if (!map.has(key)) map.set(key, obj);
  }

  for (const t of schema.tables) {
    const obj: SchemaObject = { objectType: 'Table', fullName: t.fullName, label: t.tableName, definition: generateTableDdl(t) };
    add(t.fullName, obj);
    add(t.fullName.toLowerCase(), obj);
    add(t.tableName.toLowerCase(), obj);
  }
  for (const v of schema.views) {
    const obj: SchemaObject = { objectType: 'View', fullName: v.fullName, label: v.viewName, definition: v.definition ?? '' };
    add(v.fullName, obj);
    add(v.fullName.toLowerCase(), obj);
    add(v.viewName.toLowerCase(), obj);
  }
  for (const p of schema.storedProcedures) {
    const obj: SchemaObject = { objectType: 'Procedure', fullName: p.fullName, label: p.procedureName, definition: p.definition ?? '' };
    add(p.fullName, obj);
    add(p.fullName.toLowerCase(), obj);
    add(p.procedureName.toLowerCase(), obj);
  }
  for (const f of schema.functions) {
    const obj: SchemaObject = { objectType: 'Function', fullName: f.fullName, label: f.functionName, definition: f.definition ?? '' };
    add(f.fullName, obj);
    add(f.fullName.toLowerCase(), obj);
    add(f.functionName.toLowerCase(), obj);
  }
  for (const t of schema.triggers) {
    const obj: SchemaObject = { objectType: 'Trigger', fullName: t.fullName, label: t.triggerName, definition: t.definition ?? '' };
    add(t.fullName, obj);
    add(t.fullName.toLowerCase(), obj);
    add(t.triggerName.toLowerCase(), obj);
  }

  return map;
}

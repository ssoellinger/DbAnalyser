import type { DatabaseSchema } from '../../api/types';

export interface ResolvedObject {
  objectType: string;  // Table, View, Procedure, Function, Trigger
  fullName: string;    // e.g. "dbo.GetUsers"
  label: string;       // short name for tab
  definition: string;  // SQL code or generated DDL
}

/**
 * Builds a lookup map from identifier names to schema objects.
 * Supports: fullName, unqualified name, and [bracketed] variants.
 */
export function buildIdentifierMap(schema: DatabaseSchema | null): Map<string, ResolvedObject> {
  const map = new Map<string, ResolvedObject>();
  if (!schema) return map;

  function add(key: string, obj: ResolvedObject) {
    const lower = key.toLowerCase();
    if (!map.has(lower)) {
      map.set(lower, obj);
    }
  }

  // Tables
  for (const t of schema.tables) {
    const obj: ResolvedObject = {
      objectType: 'Table',
      fullName: t.fullName,
      label: t.tableName,
      definition: '', // will be filled with generated DDL on demand
    };
    add(t.fullName, obj);
    add(t.tableName, obj);
    add(`[${t.schemaName}].[${t.tableName}]`, obj);
    add(`[${t.tableName}]`, obj);
  }

  // Views
  for (const v of schema.views) {
    const obj: ResolvedObject = {
      objectType: 'View',
      fullName: v.fullName,
      label: v.viewName,
      definition: v.definition ?? '',
    };
    add(v.fullName, obj);
    add(v.viewName, obj);
    add(`[${v.schemaName}].[${v.viewName}]`, obj);
    add(`[${v.viewName}]`, obj);
  }

  // Stored Procedures
  for (const p of schema.storedProcedures) {
    const obj: ResolvedObject = {
      objectType: 'Procedure',
      fullName: p.fullName,
      label: p.procedureName,
      definition: p.definition ?? '',
    };
    add(p.fullName, obj);
    add(p.procedureName, obj);
    add(`[${p.schemaName}].[${p.procedureName}]`, obj);
    add(`[${p.procedureName}]`, obj);
  }

  // Functions
  for (const f of schema.functions) {
    const obj: ResolvedObject = {
      objectType: 'Function',
      fullName: f.fullName,
      label: f.functionName,
      definition: f.definition ?? '',
    };
    add(f.fullName, obj);
    add(f.functionName, obj);
    add(`[${f.schemaName}].[${f.functionName}]`, obj);
    add(`[${f.functionName}]`, obj);
  }

  // Triggers
  for (const t of schema.triggers) {
    const obj: ResolvedObject = {
      objectType: 'Trigger',
      fullName: t.fullName,
      label: t.triggerName,
      definition: t.definition ?? '',
    };
    add(t.fullName, obj);
    add(t.triggerName, obj);
    add(`[${t.schemaName}].[${t.triggerName}]`, obj);
    add(`[${t.triggerName}]`, obj);
  }

  return map;
}

/**
 * Resolve an identifier string to a known database object.
 * Strips brackets, handles schema.name and unqualified names.
 */
export function resolveIdentifier(
  text: string,
  identifierMap: Map<string, ResolvedObject>
): ResolvedObject | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  // Try exact match first
  const exact = identifierMap.get(cleaned.toLowerCase());
  if (exact) return exact;

  // Strip outer brackets: [dbo].[Name] → dbo.Name
  const stripped = cleaned.replace(/\[([^\]]+)\]/g, '$1');
  const found = identifierMap.get(stripped.toLowerCase());
  if (found) return found;

  return null;
}

import type { DatabaseSchema } from '../../api/types';
import { generateSynonymDdl, generateJobDdl } from './tableDdlGenerator';

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

  // Helper: register all name variants including 3-part (server mode) and 2-part
  function addAllVariants(
    fullName: string,
    schemaName: string,
    objectName: string,
    databaseName: string | undefined,
    obj: ResolvedObject,
  ) {
    add(fullName, obj);
    add(objectName, obj);
    add(`[${schemaName}].[${objectName}]`, obj);
    add(`[${objectName}]`, obj);
    // Two-part unbracketed (schema.name) — needed when fullName is 3-part (server mode)
    add(`${schemaName}.${objectName}`, obj);
    if (databaseName) {
      // Three-part bracketed variant
      add(`[${databaseName}].[${schemaName}].[${objectName}]`, obj);
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
    addAllVariants(t.fullName, t.schemaName, t.tableName, t.databaseName, obj);
  }

  // Views
  for (const v of schema.views) {
    const obj: ResolvedObject = {
      objectType: 'View',
      fullName: v.fullName,
      label: v.viewName,
      definition: v.definition ?? '',
    };
    addAllVariants(v.fullName, v.schemaName, v.viewName, v.databaseName, obj);
  }

  // Stored Procedures
  for (const p of schema.storedProcedures) {
    const obj: ResolvedObject = {
      objectType: 'Procedure',
      fullName: p.fullName,
      label: p.procedureName,
      definition: p.definition ?? '',
    };
    addAllVariants(p.fullName, p.schemaName, p.procedureName, p.databaseName, obj);
  }

  // Functions
  for (const f of schema.functions) {
    const obj: ResolvedObject = {
      objectType: 'Function',
      fullName: f.fullName,
      label: f.functionName,
      definition: f.definition ?? '',
    };
    addAllVariants(f.fullName, f.schemaName, f.functionName, f.databaseName, obj);
  }

  // Triggers
  for (const t of schema.triggers) {
    const obj: ResolvedObject = {
      objectType: 'Trigger',
      fullName: t.fullName,
      label: t.triggerName,
      definition: t.definition ?? '',
    };
    addAllVariants(t.fullName, t.schemaName, t.triggerName, t.databaseName, obj);
  }

  // Sequences
  for (const seq of schema.sequences) {
    const obj: ResolvedObject = {
      objectType: 'Sequence',
      fullName: seq.fullName,
      label: seq.sequenceName,
      definition: '',
    };
    addAllVariants(seq.fullName, seq.schemaName, seq.sequenceName, seq.databaseName, obj);
  }

  // User-Defined Types
  for (const udt of schema.userDefinedTypes) {
    const obj: ResolvedObject = {
      objectType: 'Type',
      fullName: udt.fullName,
      label: udt.typeName,
      definition: '',
    };
    addAllVariants(udt.fullName, udt.schemaName, udt.typeName, udt.databaseName, obj);
  }

  // Synonyms — resolve to the synonym itself (shows CREATE SYNONYM DDL)
  for (const s of schema.synonyms) {
    const obj: ResolvedObject = {
      objectType: 'Synonym',
      fullName: s.fullName,
      label: s.synonymName,
      definition: generateSynonymDdl(s),
    };
    addAllVariants(s.fullName, s.schemaName, s.synonymName, s.databaseName, obj);
  }

  // Jobs — server-level, no schema prefix
  for (const j of schema.jobs) {
    const obj: ResolvedObject = {
      objectType: 'Job',
      fullName: j.jobName,
      label: j.jobName,
      definition: generateJobDdl(j),
    };
    add(j.jobName, obj);
    add(`[${j.jobName}]`, obj);
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

  // For 3-part names (db.schema.name), also try the 2-part (schema.name)
  const dotParts = stripped.split('.');
  if (dotParts.length === 3) {
    const twoPart = `${dotParts[1]}.${dotParts[2]}`;
    const found2 = identifierMap.get(twoPart.toLowerCase());
    if (found2) return found2;
    // Try just the object name
    const found1 = identifierMap.get(dotParts[2].toLowerCase());
    if (found1) return found1;
  }

  return null;
}

// ── Analysis Result ──────────────────────────────────────────────────────────

export interface AnalysisResult {
  databaseName: string;
  analyzedAt: string;
  schema: DatabaseSchema | null;
  profiles: TableProfile[] | null;
  relationships: RelationshipMap | null;
  qualityIssues: QualityIssue[] | null;
  usageAnalysis: UsageAnalysis | null;
  isServerMode: boolean;
  databases: string[];
  failedDatabases: DatabaseError[];
}

export interface DatabaseError {
  databaseName: string;
  error: string;
}

// ── Schema ──────────────────────────────────────────────────────────────────

export interface DatabaseSchema {
  databaseName: string;
  tables: TableInfo[];
  views: ViewInfo[];
  storedProcedures: StoredProcedureInfo[];
  functions: FunctionInfo[];
  triggers: TriggerInfo[];
  synonyms: SynonymInfo[];
  sequences: SequenceInfo[];
  userDefinedTypes: UserDefinedTypeInfo[];
  jobs: JobInfo[];
}

export interface TableInfo {
  schemaName: string;
  tableName: string;
  databaseName?: string;
  fullName: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  defaultValue: string | null;
  ordinalPosition: number;
}

export interface IndexInfo {
  name: string;
  type: string;
  isUnique: boolean;
  isClustered: boolean;
  columns: string[];
}

export interface ForeignKeyInfo {
  name: string;
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  deleteRule: string;
  updateRule: string;
  fromDatabase?: string;
  toDatabase?: string;
}

export interface ViewInfo {
  schemaName: string;
  viewName: string;
  databaseName?: string;
  fullName: string;
  definition: string;
  columns: ColumnInfo[];
}

export interface StoredProcedureInfo {
  schemaName: string;
  procedureName: string;
  databaseName?: string;
  fullName: string;
  definition: string;
  lastModified: string | null;
}

export interface FunctionInfo {
  schemaName: string;
  functionName: string;
  databaseName?: string;
  fullName: string;
  functionType: string;
  definition: string;
  lastModified: string | null;
}

export interface TriggerInfo {
  schemaName: string;
  triggerName: string;
  databaseName?: string;
  fullName: string;
  parentTable: string;
  parentFullName: string;
  triggerType: string;
  triggerEvents: string;
  isEnabled: boolean;
  definition: string;
}

export interface SynonymInfo {
  schemaName: string;
  synonymName: string;
  databaseName?: string;
  fullName: string;
  baseObjectName: string;
}

export interface SequenceInfo {
  schemaName: string;
  sequenceName: string;
  databaseName?: string;
  fullName: string;
  dataType: string;
  currentValue: number;
  increment: number;
  minValue: number;
  maxValue: number;
  isCycling: boolean;
}

export interface UserDefinedTypeInfo {
  schemaName: string;
  typeName: string;
  databaseName?: string;
  fullName: string;
  baseType: string;
  isTableType: boolean;
  isNullable: boolean;
  maxLength: number | null;
}

export interface JobInfo {
  jobName: string;
  description: string;
  isEnabled: boolean;
  steps: JobStepInfo[];
  lastRunDate: string | null;
  scheduleDescription: string | null;
}

export interface JobStepInfo {
  stepId: number;
  stepName: string;
  subsystemType: string;
  databaseName: string | null;
  command: string;
}

// ── Profiling ───────────────────────────────────────────────────────────────

export interface TableProfile {
  schemaName: string;
  tableName: string;
  databaseName?: string;
  fullName: string;
  rowCount: number;
  columnProfiles: ColumnProfile[];
}

export interface ColumnProfile {
  columnName: string;
  dataType: string;
  totalCount: number;
  nullCount: number;
  distinctCount: number;
  minValue: string | null;
  maxValue: string | null;
  nullPercentage: number;
}

// ── Relationships ───────────────────────────────────────────────────────────

export interface RelationshipMap {
  explicitRelationships: ForeignKeyInfo[];
  implicitRelationships: ImplicitRelationship[];
  dependencies: TableDependency[];
  viewDependencies: ObjectDependency[];
}

export interface ImplicitRelationship {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  confidence: number;
  reason: string;
  fromDatabase?: string;
  toDatabase?: string;
}

export interface TableDependency {
  schemaName: string;
  tableName: string;
  databaseName?: string;
  fullName: string;
  objectType: string;
  externalDatabase: string | null;
  isExternal: boolean;
  dependsOn: string[];
  referencedBy: string[];
  transitiveImpact: string[];
  directConnections: number;
  importanceScore: number;
}

export interface ObjectDependency {
  fromSchema: string;
  fromName: string;
  fromType: string;
  toSchema: string;
  toName: string;
  toType: string;
  toDatabase: string | null;
  detectedVia: string | null;
  isCrossDatabase: boolean;
  toFullName: string;
  fromDatabase?: string;
  fromFullName: string;
}

// ── Quality ─────────────────────────────────────────────────────────────────

export type IssueSeverity = 'info' | 'warning' | 'error';

export interface QualityIssue {
  category: string;
  severity: IssueSeverity;
  objectName: string;
  description: string;
  recommendation: string | null;
}

// ── Usage ────────────────────────────────────────────────────────────────────

export type UsageLevel = 'active' | 'low' | 'unused' | 'unknown';

export interface ObjectUsage {
  objectName: string;
  objectType: string;
  databaseName?: string;
  usageLevel: UsageLevel;
  score: number;
  evidence: string[];
}

export interface UsageAnalysis {
  serverStartTime: string | null;
  serverUptimeDays: number | null;
  objects: ObjectUsage[];
}

// ── Analyzer Names ──────────────────────────────────────────────────────────

export type AnalyzerName = 'schema' | 'profiling' | 'relationships' | 'quality' | 'usage';

export type AnalyzerStatus = 'idle' | 'loading' | 'loaded' | 'error';

// ── API DTOs ────────────────────────────────────────────────────────────────

export interface ConnectResult {
  sessionId: string;
  databaseName: string | null;
  isServerMode: boolean;
  serverName: string | null;
}

export interface AnalysisProgress {
  step: string;
  current: number;
  total: number;
  status: string;
  percentage: number;
}

// ── Object type colors (matching HTML report) ───────────────────────────────

export const OBJECT_TYPE_COLORS: Record<string, string> = {
  Table: '#e94560',
  View: '#4ecca3',
  Procedure: '#f0a500',
  Function: '#bb86fc',
  Trigger: '#ff7043',
  Synonym: '#78909c',
  Job: '#26a69a',
  External: '#ff6b6b',
};

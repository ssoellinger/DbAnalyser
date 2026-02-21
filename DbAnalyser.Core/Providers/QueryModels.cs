namespace DbAnalyser.Providers;

/// <summary>Row DTOs returned by ICatalogQueries / IPerformanceQueries / IServerQueries.
/// These are provider-agnostic — each engine maps its catalog/DMV results into these shapes.</summary>

// ── Schema (ICatalogQueries) ──────────────────────────────────────────

public record ColumnRow(
    string Schema, string Table, string TableType,
    string Name, string DataType, int? MaxLength, int? Precision, int? Scale,
    bool IsNullable, bool IsPrimaryKey, bool IsIdentity, bool IsComputed,
    string? DefaultValue, int OrdinalPosition);

public record IndexRow(
    string SchemaName, string TableName, string IndexName, string IndexType,
    bool IsUnique, bool IsClustered, string Columns);

public record ForeignKeyRow(
    string FkName, string FromSchema, string FromTable, string FromColumn,
    string ToSchema, string ToTable, string ToColumn,
    string DeleteRule, string UpdateRule);

public record ViewRow(string Schema, string Name, string Definition);

public record StoredProcRow(
    string SchemaName, string ProcedureName, string Definition, DateTime? LastModified);

public record FunctionRow(
    string SchemaName, string FunctionName, string FunctionType,
    string Definition, DateTime? LastModified);

public record TriggerRow(
    string SchemaName, string TriggerName, string ParentTable,
    string TriggerType, string TriggerEvents, bool IsEnabled, string Definition);

public record SynonymRow(string SchemaName, string SynonymName, string BaseObjectName);

public record SequenceRow(
    string SchemaName, string SequenceName, string DataType,
    long CurrentValue, long Increment, long MinValue, long MaxValue, bool IsCycling);

public record UdtRow(
    string SchemaName, string TypeName, string BaseType,
    bool IsTableType, bool IsNullable, int? MaxLength);

public record JobRow(
    string JobName, string Description, bool IsEnabled,
    List<JobStepRow> Steps, DateTime? LastRunDate, string? ScheduleDescription);

public record JobStepRow(
    int StepId, string StepName, string SubsystemType,
    string? DatabaseName, string Command);

// ── Relationships (ICatalogQueries) ───────────────────────────────────

public record ObjectDependencyRow(
    string FromSchema, string FromName, string FromType,
    string ToSchema, string ToName, string ToType, string? ToDatabase);

// ── Performance (IPerformanceQueries) ─────────────────────────────────

public record MissingIndexRow(
    string SchemaName, string TableName, double ImpactScore,
    string? EqualityColumns, string? InequalityColumns, string? IncludeColumns,
    long? UserSeeks, long? UserScans);

public record TableUsageRow(
    string SchemaName, string TableName,
    long TotalReads, long TotalWrites,
    DateTime? LastSeek, DateTime? LastScan, DateTime? LastLookup);

public record ProcUsageRow(
    string SchemaName, string ProcName,
    long ExecutionCount, DateTime? LastExecution);

public record FuncUsageRow(
    string SchemaName, string FuncName,
    long ExecutionCount, DateTime? LastExecution);

public record QsProcRow(
    string SchemaName, string ObjectName, string ObjectType,
    long TotalExecutions, DateTime? LastExecution, DateTime? FirstExecution);

public record QsTextRow(
    string QueryText, long TotalExecutions, DateTime? LastExecution);

namespace DbAnalyser.Providers;

/// <summary>Schema metadata extraction — provider-specific SQL lives behind this interface.</summary>
public interface ICatalogQueries
{
    // Schema
    Task<List<ColumnRow>> GetAllColumnsAsync(IDbProvider provider, CancellationToken ct);
    Task<List<IndexRow>> GetAllIndexesAsync(IDbProvider provider, CancellationToken ct);
    Task<List<ForeignKeyRow>> GetAllForeignKeysAsync(IDbProvider provider, CancellationToken ct);
    Task<List<ViewRow>> GetAllViewsAsync(IDbProvider provider, CancellationToken ct);
    Task<List<StoredProcRow>> GetStoredProceduresAsync(IDbProvider provider, CancellationToken ct);
    Task<List<FunctionRow>> GetFunctionsAsync(IDbProvider provider, CancellationToken ct);
    Task<List<TriggerRow>> GetTriggersAsync(IDbProvider provider, CancellationToken ct);
    Task<List<SynonymRow>> GetSynonymsAsync(IDbProvider provider, CancellationToken ct);
    Task<List<SequenceRow>> GetSequencesAsync(IDbProvider provider, CancellationToken ct);
    Task<List<UdtRow>> GetUserDefinedTypesAsync(IDbProvider provider, CancellationToken ct);
    Task<List<JobRow>> GetJobsAsync(IDbProvider provider, string databaseName, CancellationToken ct);

    // Relationships
    Task<List<ObjectDependencyRow>> GetObjectDependenciesAsync(IDbProvider provider, CancellationToken ct);

    // Profiling SQL builders
    string BuildCountSql(string schema, string table);
    string BuildColumnProfileSql(string schema, string table, string column, bool canMinMax);
    string BuildNullCountSql(string schema, string table, string column);
}

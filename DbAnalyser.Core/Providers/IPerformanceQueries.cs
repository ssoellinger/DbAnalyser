using DbAnalyser.Models.Indexing;

namespace DbAnalyser.Providers;

/// <summary>DMV / usage metrics — provider-specific SQL lives behind this interface.</summary>
public interface IPerformanceQueries
{
    // Indexing
    Task<List<IndexInventoryItem>> GetIndexInventoryAsync(IDbProvider provider, CancellationToken ct);
    Task<List<MissingIndexRow>> GetMissingIndexesAsync(IDbProvider provider, CancellationToken ct);

    // Usage signals
    Task<List<TableUsageRow>> GetTableUsageStatsAsync(IDbProvider provider, CancellationToken ct);
    Task<List<ProcUsageRow>> GetProcExecutionStatsAsync(IDbProvider provider, CancellationToken ct);
    Task<List<FuncUsageRow>> GetFunctionExecutionStatsAsync(IDbProvider provider, CancellationToken ct);
    Task<bool> IsQueryStoreEnabledAsync(IDbProvider provider, CancellationToken ct);
    Task<List<QsProcRow>> GetQueryStoreProcStatsAsync(IDbProvider provider, CancellationToken ct);
    Task<List<QsTextRow>> GetQueryStoreTopQueriesAsync(IDbProvider provider, int topN, CancellationToken ct);
}

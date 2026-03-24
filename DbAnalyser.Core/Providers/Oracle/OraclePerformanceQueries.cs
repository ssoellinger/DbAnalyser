using DbAnalyser.Models.Indexing;

namespace DbAnalyser.Providers.Oracle;

public class OraclePerformanceQueries : IPerformanceQueries
{
    public Task<List<IndexInventoryItem>> GetIndexInventoryAsync(IDbProvider provider, CancellationToken ct)
    {
        // MVP: return empty — Oracle index usage stats require DBA privileges or Diagnostic Pack
        return Task.FromResult(new List<IndexInventoryItem>());
    }

    public Task<List<MissingIndexRow>> GetMissingIndexesAsync(IDbProvider provider, CancellationToken ct)
    {
        // Oracle doesn't have a built-in missing index advisor like SQL Server
        return Task.FromResult(new List<MissingIndexRow>());
    }

    public Task<List<TableUsageRow>> GetTableUsageStatsAsync(IDbProvider provider, CancellationToken ct)
    {
        // Requires Oracle Diagnostic Pack license
        return Task.FromResult(new List<TableUsageRow>());
    }

    public Task<List<ProcUsageRow>> GetProcExecutionStatsAsync(IDbProvider provider, CancellationToken ct)
    {
        return Task.FromResult(new List<ProcUsageRow>());
    }

    public Task<List<FuncUsageRow>> GetFunctionExecutionStatsAsync(IDbProvider provider, CancellationToken ct)
    {
        return Task.FromResult(new List<FuncUsageRow>());
    }

    public Task<bool> IsQueryStoreEnabledAsync(IDbProvider provider, CancellationToken ct)
    {
        // Oracle doesn't have Query Store
        return Task.FromResult(false);
    }

    public Task<List<QsProcRow>> GetQueryStoreProcStatsAsync(IDbProvider provider, CancellationToken ct)
    {
        return Task.FromResult(new List<QsProcRow>());
    }

    public Task<List<QsTextRow>> GetQueryStoreTopQueriesAsync(IDbProvider provider, int topN, CancellationToken ct)
    {
        return Task.FromResult(new List<QsTextRow>());
    }
}

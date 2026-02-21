namespace DbAnalyser.Providers;

/// <summary>Server-level operations — provider-specific SQL lives behind this interface.</summary>
public interface IServerQueries
{
    Task<List<string>> EnumerateDatabasesAsync(IDbProvider provider, CancellationToken ct);
    Task<(DateTime? StartTime, int? UptimeDays)> GetServerUptimeAsync(IDbProvider provider, CancellationToken ct);
}

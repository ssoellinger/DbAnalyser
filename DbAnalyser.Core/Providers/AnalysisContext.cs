namespace DbAnalyser.Providers;

/// <summary>Passed to analyzers instead of raw IDbProvider — provides both transport and dialect abstraction.</summary>
public class AnalysisContext
{
    public required IDbProvider Provider { get; init; }
    public required ICatalogQueries CatalogQueries { get; init; }
    public required IPerformanceQueries PerformanceQueries { get; init; }
    public required IServerQueries ServerQueries { get; init; }
    public required string ProviderType { get; init; }
}

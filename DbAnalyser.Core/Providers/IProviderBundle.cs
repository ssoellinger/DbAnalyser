namespace DbAnalyser.Providers;

/// <summary>Groups all per-engine services into a single registrable unit.</summary>
public interface IProviderBundle
{
    string ProviderType { get; }
    IDbProviderFactory Factory { get; }
    ICatalogQueries CatalogQueries { get; }
    IPerformanceQueries PerformanceQueries { get; }
    IServerQueries ServerQueries { get; }
}

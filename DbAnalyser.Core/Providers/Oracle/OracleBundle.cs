namespace DbAnalyser.Providers.Oracle;

public class OracleBundle : IProviderBundle
{
    public string ProviderType => "oracle";
    public IDbProviderFactory Factory { get; } = new OracleProviderFactory();
    public ICatalogQueries CatalogQueries { get; } = new OracleCatalogQueries();
    public IPerformanceQueries PerformanceQueries { get; } = new OraclePerformanceQueries();
    public IServerQueries ServerQueries { get; } = new OracleServerQueries();
}

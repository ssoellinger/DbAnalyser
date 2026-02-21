namespace DbAnalyser.Providers.SqlServer;

public class SqlServerBundle : IProviderBundle
{
    public string ProviderType => "sqlserver";
    public IDbProviderFactory Factory { get; } = new SqlServerProviderFactory();
    public ICatalogQueries CatalogQueries { get; } = new SqlServerCatalogQueries();
    public IPerformanceQueries PerformanceQueries { get; } = new SqlServerPerformanceQueries();
    public IServerQueries ServerQueries { get; } = new SqlServerServerQueries();
}

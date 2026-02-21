namespace DbAnalyser.Providers.PostgreSql;

public class PostgreSqlBundle : IProviderBundle
{
    public string ProviderType => "postgresql";
    public IDbProviderFactory Factory { get; } = new PostgreSqlProviderFactory();
    public ICatalogQueries CatalogQueries { get; } = new PostgreSqlCatalogQueries();
    public IPerformanceQueries PerformanceQueries { get; } = new PostgreSqlPerformanceQueries();
    public IServerQueries ServerQueries { get; } = new PostgreSqlServerQueries();
}

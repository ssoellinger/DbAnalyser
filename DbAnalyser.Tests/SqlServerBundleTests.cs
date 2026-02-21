using DbAnalyser.Providers.SqlServer;

namespace DbAnalyser.Tests;

public class SqlServerBundleTests
{
    [Fact]
    public void ProviderType_IsSqlServer()
    {
        var bundle = new SqlServerBundle();

        Assert.Equal("sqlserver", bundle.ProviderType);
    }

    [Fact]
    public void Factory_IsNotNull()
    {
        var bundle = new SqlServerBundle();

        Assert.NotNull(bundle.Factory);
        Assert.IsType<SqlServerProviderFactory>(bundle.Factory);
    }

    [Fact]
    public void CatalogQueries_IsNotNull()
    {
        var bundle = new SqlServerBundle();

        Assert.NotNull(bundle.CatalogQueries);
        Assert.IsType<SqlServerCatalogQueries>(bundle.CatalogQueries);
    }

    [Fact]
    public void PerformanceQueries_IsNotNull()
    {
        var bundle = new SqlServerBundle();

        Assert.NotNull(bundle.PerformanceQueries);
        Assert.IsType<SqlServerPerformanceQueries>(bundle.PerformanceQueries);
    }

    [Fact]
    public void ServerQueries_IsNotNull()
    {
        var bundle = new SqlServerBundle();

        Assert.NotNull(bundle.ServerQueries);
        Assert.IsType<SqlServerServerQueries>(bundle.ServerQueries);
    }

    [Fact]
    public void Factory_ProviderType_MatchesBundle()
    {
        var bundle = new SqlServerBundle();

        Assert.Equal(bundle.ProviderType, bundle.Factory.ProviderType);
    }
}

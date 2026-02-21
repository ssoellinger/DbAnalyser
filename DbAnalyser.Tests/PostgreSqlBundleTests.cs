using DbAnalyser.Providers.PostgreSql;

namespace DbAnalyser.Tests;

public class PostgreSqlBundleTests
{
    [Fact]
    public void ProviderType_IsPostgresql()
    {
        var bundle = new PostgreSqlBundle();

        Assert.Equal("postgresql", bundle.ProviderType);
    }

    [Fact]
    public void Factory_IsNotNull()
    {
        var bundle = new PostgreSqlBundle();

        Assert.NotNull(bundle.Factory);
        Assert.IsType<PostgreSqlProviderFactory>(bundle.Factory);
    }

    [Fact]
    public void CatalogQueries_IsNotNull()
    {
        var bundle = new PostgreSqlBundle();

        Assert.NotNull(bundle.CatalogQueries);
        Assert.IsType<PostgreSqlCatalogQueries>(bundle.CatalogQueries);
    }

    [Fact]
    public void PerformanceQueries_IsNotNull()
    {
        var bundle = new PostgreSqlBundle();

        Assert.NotNull(bundle.PerformanceQueries);
        Assert.IsType<PostgreSqlPerformanceQueries>(bundle.PerformanceQueries);
    }

    [Fact]
    public void ServerQueries_IsNotNull()
    {
        var bundle = new PostgreSqlBundle();

        Assert.NotNull(bundle.ServerQueries);
        Assert.IsType<PostgreSqlServerQueries>(bundle.ServerQueries);
    }

    [Fact]
    public void Factory_ProviderType_MatchesBundle()
    {
        var bundle = new PostgreSqlBundle();

        Assert.Equal(bundle.ProviderType, bundle.Factory.ProviderType);
    }
}

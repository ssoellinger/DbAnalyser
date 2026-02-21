using DbAnalyser.Providers;
using DbAnalyser.Providers.PostgreSql;
using NSubstitute;

namespace DbAnalyser.Tests;

public class PostgreSqlCatalogQueriesTests
{
    private readonly PostgreSqlCatalogQueries _queries = new();

    [Fact]
    public void BuildCountSql_UsesDoubleQuotes()
    {
        var sql = _queries.BuildCountSql("public", "users");

        Assert.Equal("SELECT COUNT(*) FROM \"public\".\"users\"", sql);
    }

    [Fact]
    public void BuildColumnProfileSql_WithMinMax_UsesDoubleQuotes()
    {
        var sql = _queries.BuildColumnProfileSql("public", "users", "name", canMinMax: true);

        Assert.Contains("\"name\"", sql);
        Assert.Contains("\"public\".\"users\"", sql);
        Assert.Contains("MIN(\"name\")", sql);
        Assert.Contains("MAX(\"name\")", sql);
    }

    [Fact]
    public void BuildColumnProfileSql_WithoutMinMax_ReturnsNullMinMax()
    {
        var sql = _queries.BuildColumnProfileSql("public", "users", "data", canMinMax: false);

        Assert.Contains("NULL AS \"MinVal\"", sql);
        Assert.Contains("NULL AS \"MaxVal\"", sql);
        Assert.DoesNotContain("MIN(", sql);
        Assert.DoesNotContain("MAX(", sql);
    }

    [Fact]
    public void BuildNullCountSql_UsesDoubleQuotes()
    {
        var sql = _queries.BuildNullCountSql("public", "users", "email");

        Assert.Equal("SELECT COUNT(*) FROM \"public\".\"users\" WHERE \"email\" IS NULL", sql);
    }

    [Fact]
    public async Task GetSynonymsAsync_ReturnsEmpty()
    {
        var provider = Substitute.For<IDbProvider>();

        var result = await _queries.GetSynonymsAsync(provider, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetJobsAsync_ReturnsEmpty()
    {
        var provider = Substitute.For<IDbProvider>();

        var result = await _queries.GetJobsAsync(provider, "testdb", CancellationToken.None);

        Assert.Empty(result);
    }
}

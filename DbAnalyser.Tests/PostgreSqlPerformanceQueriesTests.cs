using DbAnalyser.Providers;
using DbAnalyser.Providers.PostgreSql;
using NSubstitute;

namespace DbAnalyser.Tests;

public class PostgreSqlPerformanceQueriesTests
{
    private readonly PostgreSqlPerformanceQueries _queries = new();

    [Fact]
    public async Task GetMissingIndexesAsync_ReturnsEmpty()
    {
        var provider = Substitute.For<IDbProvider>();

        var result = await _queries.GetMissingIndexesAsync(provider, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetProcExecutionStatsAsync_ReturnsEmpty()
    {
        var provider = Substitute.For<IDbProvider>();

        var result = await _queries.GetProcExecutionStatsAsync(provider, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetFunctionExecutionStatsAsync_ReturnsEmpty()
    {
        var provider = Substitute.For<IDbProvider>();

        var result = await _queries.GetFunctionExecutionStatsAsync(provider, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task IsQueryStoreEnabledAsync_ReturnsFalse()
    {
        var provider = Substitute.For<IDbProvider>();

        var result = await _queries.IsQueryStoreEnabledAsync(provider, CancellationToken.None);

        Assert.False(result);
    }

    [Fact]
    public async Task GetQueryStoreProcStatsAsync_ReturnsEmpty()
    {
        var provider = Substitute.For<IDbProvider>();

        var result = await _queries.GetQueryStoreProcStatsAsync(provider, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetQueryStoreTopQueriesAsync_ReturnsEmpty()
    {
        var provider = Substitute.For<IDbProvider>();

        var result = await _queries.GetQueryStoreTopQueriesAsync(provider, 10, CancellationToken.None);

        Assert.Empty(result);
    }
}

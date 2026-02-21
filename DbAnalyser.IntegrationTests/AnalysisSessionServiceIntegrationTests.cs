using DbAnalyser.Analyzers;
using DbAnalyser.Api.Hubs;
using DbAnalyser.Api.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbAnalyser.IntegrationTests;

/// <summary>
/// Integration tests for AnalysisSessionService — verifies the full
/// connect → analyze → disconnect flow in both server mode and single-DB mode.
/// </summary>
public class AnalysisSessionServiceIntegrationTests : IClassFixture<TestFixture>, IAsyncDisposable
{
    private readonly TestFixture _fixture;
    private readonly AnalysisSessionService _service;

    public AnalysisSessionServiceIntegrationTests(TestFixture fixture)
    {
        _fixture = fixture;

        // Build a minimal service provider with the real analyzers
        var services = new ServiceCollection();
        services.AddSingleton<IAnalyzer, SchemaAnalyzer>();
        services.AddSingleton<IAnalyzer, DataProfileAnalyzer>();
        services.AddSingleton<IAnalyzer, RelationshipAnalyzer>();
        services.AddSingleton<IAnalyzer, QualityAnalyzer>();
        services.AddSingleton<IAnalyzer, UsageAnalyzer>();
        services.AddSignalRCore();
        services.AddLogging();

        var provider = services.BuildServiceProvider();

        _service = new AnalysisSessionService(
            provider,
            provider.GetRequiredService<IHubContext<AnalysisHub>>(),
            provider.GetRequiredService<ILogger<AnalysisSessionService>>());
    }

    [SqlServerFact]
    public async Task ConnectAsync_ServerMode_NoDatabase_ReturnsServerModeResult()
    {
        // Connection string WITHOUT Initial Catalog → server mode
        var builder = new SqlConnectionStringBuilder(_fixture.ConnectionString!);
        builder.Remove("Initial Catalog");
        builder.Remove("Database");

        var result = await _service.ConnectAsync(builder.ConnectionString);

        Assert.True(result.IsServerMode);
        Assert.NotNull(result.ServerName);
        Assert.Null(result.DatabaseName);
        Assert.False(string.IsNullOrEmpty(result.SessionId));

        await _service.DisconnectAsync(result.SessionId);
    }

    [SqlServerFact]
    public async Task ConnectAsync_SingleDbMode_WithDatabase_ReturnsDatabaseName()
    {
        // Find all user databases, then try each until one is accessible
        var masterBuilder = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
        {
            InitialCatalog = "master",
            MultipleActiveResultSets = true
        };
        List<string> databases;
        await using (var conn = new SqlConnection(masterBuilder.ConnectionString))
        {
            await conn.OpenAsync();
            await using var cmd = new SqlCommand(
                "SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb') AND state_desc = 'ONLINE' ORDER BY name",
                conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            databases = [];
            while (await reader.ReadAsync())
                databases.Add(reader.GetString(0));
        }

        Assert.NotEmpty(databases);

        // Try each database until we find one we can connect to
        foreach (var dbName in databases)
        {
            try
            {
                var dbBuilder = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
                {
                    InitialCatalog = dbName
                };

                var result = await _service.ConnectAsync(dbBuilder.ConnectionString);

                Assert.False(result.IsServerMode);
                Assert.Equal(dbName, result.DatabaseName);
                Assert.False(string.IsNullOrEmpty(result.SessionId));

                await _service.DisconnectAsync(result.SessionId);
                return; // Success
            }
            catch (SqlException)
            {
                // This DB is not accessible, try the next one
            }
        }

        Assert.Fail("Could not connect to any user database in single-DB mode");
    }

    [SqlServerFact]
    public async Task RunAnalysisAsync_ServerMode_FullPipeline()
    {
        var builder = new SqlConnectionStringBuilder(_fixture.ConnectionString!);
        builder.Remove("Initial Catalog");
        builder.Remove("Database");

        var connectResult = await _service.ConnectAsync(builder.ConnectionString);
        Assert.True(connectResult.IsServerMode);

        var analysisResult = await _service.RunAnalysisAsync(
            connectResult.SessionId,
            ["schema"]);

        Assert.True(analysisResult.IsServerMode);
        Assert.NotEmpty(analysisResult.Databases);
        Assert.NotNull(analysisResult.Schema);
        Assert.NotEmpty(analysisResult.Schema!.Tables);

        // Verify result is also accessible via GetResult
        var cached = _service.GetResult(connectResult.SessionId);
        Assert.NotNull(cached);
        Assert.Equal(analysisResult.Databases.Count, cached!.Databases.Count);

        await _service.DisconnectAsync(connectResult.SessionId);
    }

    [SqlServerFact]
    public async Task DisconnectAsync_InvalidSession_DoesNotThrow()
    {
        // Should not throw for unknown session
        await _service.DisconnectAsync("nonexistent");
    }

    public async ValueTask DisposeAsync()
    {
        await _service.DisposeAsync();
    }
}

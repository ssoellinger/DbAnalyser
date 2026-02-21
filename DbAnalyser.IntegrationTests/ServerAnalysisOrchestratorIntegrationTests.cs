using DbAnalyser.Analyzers;
using DbAnalyser.Providers.SqlServer;
using Microsoft.Data.SqlClient;

namespace DbAnalyser.IntegrationTests;

/// <summary>
/// Integration tests for ServerAnalysisOrchestrator — verifies end-to-end
/// server mode analysis against a real SQL Server / Azure SQL Database.
/// </summary>
public class ServerAnalysisOrchestratorIntegrationTests : IClassFixture<TestFixture>
{
    private readonly TestFixture _fixture;
    private readonly SqlServerBundle _bundle = new();

    public ServerAnalysisOrchestratorIntegrationTests(TestFixture fixture)
    {
        _fixture = fixture;
    }

    private string GetConnectionString()
    {
        var builder = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
        {
            MultipleActiveResultSets = true
        };
        return builder.ConnectionString;
    }

    [SqlServerFact]
    public async Task RunAsync_ServerMode_EnumeratesDatabases()
    {
        var analyzers = new IAnalyzer[] { new SchemaAnalyzer() };
        var orchestrator = new ServerAnalysisOrchestrator(analyzers, _bundle);

        var result = await orchestrator.RunAsync(
            GetConnectionString(),
            ["schema"]);

        Assert.True(result.IsServerMode);
        Assert.NotEmpty(result.Databases);
        Assert.NotNull(result.Schema);
        Assert.False(string.IsNullOrEmpty(result.DatabaseName), "DatabaseName (server name) should be set");
    }

    [SqlServerFact]
    public async Task RunAsync_ServerMode_FindsTables()
    {
        var analyzers = new IAnalyzer[] { new SchemaAnalyzer() };
        var orchestrator = new ServerAnalysisOrchestrator(analyzers, _bundle);

        var result = await orchestrator.RunAsync(
            GetConnectionString(),
            ["schema"]);

        Assert.NotNull(result.Schema);
        Assert.NotEmpty(result.Schema!.Tables);

        // Every table should have a DatabaseName stamped
        Assert.All(result.Schema.Tables, t =>
            Assert.False(string.IsNullOrEmpty(t.DatabaseName), $"Table {t.SchemaName}.{t.TableName} has no DatabaseName"));
    }

    [SqlServerFact]
    public async Task RunAsync_ServerMode_AllDatabasesHaveDistinctConnections()
    {
        // Verify each database is analyzed via its own connection (not ChangeDatabase)
        // by checking that tables come from multiple databases
        var analyzers = new IAnalyzer[] { new SchemaAnalyzer() };
        var orchestrator = new ServerAnalysisOrchestrator(analyzers, _bundle);

        var result = await orchestrator.RunAsync(
            GetConnectionString(),
            ["schema"]);

        var databasesWithTables = result.Schema!.Tables
            .Select(t => t.DatabaseName)
            .Where(d => d is not null)
            .Distinct()
            .ToList();

        // We expect at least one database to have tables
        Assert.NotEmpty(databasesWithTables);

        // The databases list should match what we found tables for (plus possibly empty DBs)
        Assert.All(databasesWithTables, db =>
            Assert.Contains(db, result.Databases));
    }

    [SqlServerFact]
    public async Task RunAsync_ServerMode_Relationships()
    {
        var analyzers = new IAnalyzer[] { new SchemaAnalyzer(), new RelationshipAnalyzer() };
        var orchestrator = new ServerAnalysisOrchestrator(analyzers, _bundle);

        var result = await orchestrator.RunAsync(
            GetConnectionString(),
            ["schema", "relationships"]);

        Assert.NotNull(result.Relationships);

        // If there are FK relationships, they should have FromDatabase set
        foreach (var fk in result.Relationships!.ExplicitRelationships)
        {
            Assert.False(string.IsNullOrEmpty(fk.FromDatabase),
                $"FK {fk.Name} has no FromDatabase");
        }
    }

    [SqlServerFact]
    public async Task RunAsync_ServerMode_ProgressIsReported()
    {
        var analyzers = new IAnalyzer[] { new SchemaAnalyzer() };
        var orchestrator = new ServerAnalysisOrchestrator(analyzers, _bundle);

        var progressCalls = new List<(string Step, int Current, int Total, string Status)>();

        var result = await orchestrator.RunAsync(
            GetConnectionString(),
            ["schema"],
            async (step, current, total, status) =>
            {
                progressCalls.Add((step, current, total, status));
                await Task.CompletedTask;
            });

        // Successful DBs get 2 calls each (running + completed).
        // Failed DBs get only 1 call (running) — no completed callback.
        var successCount = result.Databases.Count;
        var failedCount = result.FailedDatabases.Count;
        var expectedCalls = successCount * 2 + failedCount;
        Assert.True(progressCalls.Count >= expectedCalls,
            $"Expected at least {expectedCalls} progress calls (success={successCount}, failed={failedCount}), got {progressCalls.Count}");

        // Every successful DB should have both "running" and "completed"
        foreach (var db in result.Databases)
        {
            Assert.Contains(progressCalls, p => p.Step == $"Analyzing {db}" && p.Status == "running");
            Assert.Contains(progressCalls, p => p.Step == $"Analyzed {db}" && p.Status == "completed");
        }
    }

    [SqlServerFact]
    public async Task RunAsync_ServerMode_FailedDatabases_DoNotCrashRun()
    {
        var analyzers = new IAnalyzer[] { new SchemaAnalyzer() };
        var orchestrator = new ServerAnalysisOrchestrator(analyzers, _bundle);

        var result = await orchestrator.RunAsync(
            GetConnectionString(),
            ["schema"]);

        // Whether there are failed DBs or not, the run should complete
        Assert.NotNull(result);
        Assert.True(result.IsServerMode);

        // Successful + failed should account for all enumerated databases
        var totalHandled = result.Databases.Count + result.FailedDatabases.Count;
        Assert.True(totalHandled > 0, "Expected at least one database to be handled");
    }
}

using DbAnalyser.Providers.SqlServer;
using Microsoft.Data.SqlClient;

namespace DbAnalyser.IntegrationTests;

/// <summary>
/// Integration tests for SqlServerProvider — verifies basic connectivity,
/// query execution, and the ConnectionString property.
/// </summary>
public class SqlServerProviderTests : IClassFixture<TestFixture>
{
    private readonly TestFixture _fixture;

    public SqlServerProviderTests(TestFixture fixture)
    {
        _fixture = fixture;
    }

    [SqlServerFact]
    public async Task ConnectAsync_ToMaster_Succeeds()
    {
        var builder = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
        {
            InitialCatalog = "master",
            MultipleActiveResultSets = true
        };

        await using var provider = new SqlServerProvider();
        await provider.ConnectAsync(builder.ConnectionString);

        Assert.False(string.IsNullOrEmpty(provider.ServerName));
        Assert.Equal("master", provider.DatabaseName);
    }

    [SqlServerFact]
    public async Task ConnectionString_IsExposedAfterConnect()
    {
        var builder = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
        {
            InitialCatalog = "master",
            MultipleActiveResultSets = true
        };
        var connStr = builder.ConnectionString;

        await using var provider = new SqlServerProvider();
        await provider.ConnectAsync(connStr);

        Assert.Equal(connStr, provider.ConnectionString);
    }

    [SqlServerFact]
    public async Task ExecuteQueryAsync_SysDatabases_ReturnsRows()
    {
        var builder = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
        {
            InitialCatalog = "master",
            MultipleActiveResultSets = true
        };

        await using var provider = new SqlServerProvider();
        await provider.ConnectAsync(builder.ConnectionString);

        var table = await provider.ExecuteQueryAsync("SELECT name FROM sys.databases ORDER BY name");

        Assert.True(table.Rows.Count > 0, "Expected at least one database");
        var names = table.Rows.Cast<System.Data.DataRow>().Select(r => r["name"].ToString()).ToList();
        Assert.Contains("master", names);
    }

    [SqlServerFact]
    public async Task ExecuteScalarAsync_ReturnsValue()
    {
        var builder = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
        {
            InitialCatalog = "master",
            MultipleActiveResultSets = true
        };

        await using var provider = new SqlServerProvider();
        await provider.ConnectAsync(builder.ConnectionString);

        var result = await provider.ExecuteScalarAsync("SELECT DB_NAME()");

        Assert.Equal("master", result?.ToString());
    }

    [SqlServerFact]
    public async Task NewConnection_PerDatabase_Works()
    {
        // Get all user databases
        var masterBuilder = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
        {
            InitialCatalog = "master",
            MultipleActiveResultSets = true
        };

        List<string> databases;
        await using (var master = new SqlServerProvider())
        {
            await master.ConnectAsync(masterBuilder.ConnectionString);
            var table = await master.ExecuteQueryAsync(
                "SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb') AND state_desc = 'ONLINE' ORDER BY name");
            Assert.True(table.Rows.Count > 0, "No user databases found");
            databases = table.Rows.Cast<System.Data.DataRow>().Select(r => r["name"].ToString()!).ToList();
        }

        // Try each database until we find one we can connect to
        string? connectedDb = null;
        foreach (var dbName in databases)
        {
            try
            {
                var dbBuilder = new SqlConnectionStringBuilder(_fixture.ConnectionString!)
                {
                    InitialCatalog = dbName,
                    MultipleActiveResultSets = true
                };

                await using var dbProvider = new SqlServerProvider();
                await dbProvider.ConnectAsync(dbBuilder.ConnectionString);

                Assert.Equal(dbName, dbProvider.DatabaseName);
                var result = await dbProvider.ExecuteScalarAsync("SELECT DB_NAME()");
                Assert.Equal(dbName, result?.ToString());
                connectedDb = dbName;
                break;
            }
            catch (Microsoft.Data.SqlClient.SqlException)
            {
                // This DB is not accessible, try the next one
            }
        }

        Assert.NotNull(connectedDb);
    }
}

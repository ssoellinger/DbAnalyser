using System.Data;
using DbAnalyser.Analyzers;
using DbAnalyser.Models.Profiling;
using DbAnalyser.Models.Quality;
using DbAnalyser.Models.Relationships;
using DbAnalyser.Models.Schema;
using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;
using NSubstitute;

namespace DbAnalyser.Tests;

public class ServerAnalysisOrchestratorTests
{
    /// <summary>
    /// Creates a mock IDbProvider that returns the given database names
    /// from the sys.databases enumeration query, and reports the given server name.
    /// </summary>
    private static IDbProvider CreateMasterProvider(string serverName, params string[] databaseNames)
    {
        var provider = Substitute.For<IDbProvider>();
        provider.ServerName.Returns(serverName);
        provider.DatabaseName.Returns("master");

        var table = new DataTable();
        table.Columns.Add("name", typeof(string));
        foreach (var db in databaseNames)
            table.Rows.Add(db);

        provider.ExecuteQueryAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(table));

        return provider;
    }

    /// <summary>
    /// Creates a mock IDbProvider for a specific database (used per-DB connections).
    /// </summary>
    private static IDbProvider CreateDbProvider(string dbName)
    {
        var provider = Substitute.For<IDbProvider>();
        provider.DatabaseName.Returns(dbName);
        provider.ServerName.Returns("test-server");
        return provider;
    }

    /// <summary>
    /// Builds a provider factory that returns the master provider for master connections
    /// and per-database providers for each database name.
    /// </summary>
    private static Func<string, CancellationToken, Task<IDbProvider>> CreateFactory(
        IDbProvider masterProvider,
        Dictionary<string, IDbProvider>? dbProviders = null)
    {
        return (connectionString, ct) =>
        {
            // Parse Initial Catalog from the connection string to decide which provider to return
            var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connectionString);
            var catalog = builder.InitialCatalog;

            if (catalog == "master" || string.IsNullOrEmpty(catalog))
                return Task.FromResult(masterProvider);

            if (dbProviders is not null && dbProviders.TryGetValue(catalog, out var dbProvider))
                return Task.FromResult(dbProvider);

            // Return a generic mock for any unspecified database
            return Task.FromResult(CreateDbProvider(catalog));
        };
    }

    /// <summary>
    /// Creates a factory that throws for a specific database name (simulates connection failure).
    /// </summary>
    private static Func<string, CancellationToken, Task<IDbProvider>> CreateFactoryWithFailure(
        IDbProvider masterProvider,
        string failingDatabase)
    {
        return (connectionString, ct) =>
        {
            var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connectionString);
            var catalog = builder.InitialCatalog;

            if (catalog == "master")
                return Task.FromResult(masterProvider);

            if (string.Equals(catalog, failingDatabase, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Cannot connect to database '{catalog}'");

            return Task.FromResult(CreateDbProvider(catalog));
        };
    }

    private static IAnalyzer CreateMockAnalyzer(string name, Action<IDbProvider, AnalysisResult>? onAnalyze = null)
    {
        var analyzer = Substitute.For<IAnalyzer>();
        analyzer.Name.Returns(name);
        analyzer.AnalyzeAsync(Arg.Any<IDbProvider>(), Arg.Any<AnalysisResult>(), Arg.Any<CancellationToken>())
            .Returns(callInfo =>
            {
                onAnalyze?.Invoke(callInfo.ArgAt<IDbProvider>(0), callInfo.ArgAt<AnalysisResult>(1));
                return Task.CompletedTask;
            });
        return analyzer;
    }

    // ──────────────────────────────────────────────────────
    // Tests
    // ──────────────────────────────────────────────────────

    [Fact]
    public async Task RunAsync_EnumeratesDatabases_AndReturnsServerModeResult()
    {
        var master = CreateMasterProvider("myserver", "DbA", "DbB");
        var factory = CreateFactory(master);
        var orchestrator = new ServerAnalysisOrchestrator([], factory);

        var result = await orchestrator.RunAsync(
            "Server=myserver;Initial Catalog=master",
            ["schema"]);

        Assert.True(result.IsServerMode);
        Assert.Equal("myserver", result.DatabaseName);
        Assert.Equal(["DbA", "DbB"], result.Databases);
        Assert.Empty(result.FailedDatabases);
    }

    [Fact]
    public async Task RunAsync_NoDatabases_ReturnsEmptyResult()
    {
        var master = CreateMasterProvider("myserver"); // no databases
        var factory = CreateFactory(master);
        var orchestrator = new ServerAnalysisOrchestrator([], factory);

        var result = await orchestrator.RunAsync(
            "Server=myserver;Initial Catalog=master",
            ["schema"]);

        Assert.True(result.IsServerMode);
        Assert.Empty(result.Databases);
        Assert.Empty(result.FailedDatabases);
    }

    [Fact]
    public async Task RunAsync_ConnectionFailure_LandsInFailedDatabases()
    {
        var master = CreateMasterProvider("myserver", "GoodDb", "BadDb", "GoodDb2");
        var factory = CreateFactoryWithFailure(master, "BadDb");

        var schemaAnalyzer = CreateMockAnalyzer("schema");
        var orchestrator = new ServerAnalysisOrchestrator([schemaAnalyzer], factory);

        var result = await orchestrator.RunAsync(
            "Server=myserver;Initial Catalog=master",
            ["schema"]);

        Assert.Equal(["GoodDb", "GoodDb2"], result.Databases);
        Assert.Single(result.FailedDatabases);
        Assert.Equal("BadDb", result.FailedDatabases[0].DatabaseName);
        Assert.Contains("Cannot connect", result.FailedDatabases[0].Error);
    }

    [Fact]
    public async Task RunAsync_FiltersAnalyzersByName()
    {
        var master = CreateMasterProvider("srv", "Db1");
        var factory = CreateFactory(master);

        var schema = CreateMockAnalyzer("Schema");
        var profiling = CreateMockAnalyzer("Profiling");
        var orchestrator = new ServerAnalysisOrchestrator([schema, profiling], factory);

        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["schema"]); // Only request schema, not profiling

        await schema.Received(1).AnalyzeAsync(Arg.Any<IDbProvider>(), Arg.Any<AnalysisResult>(), Arg.Any<CancellationToken>());
        await profiling.DidNotReceive().AnalyzeAsync(Arg.Any<IDbProvider>(), Arg.Any<AnalysisResult>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task RunAsync_AnalyzerNameMatching_IsCaseInsensitive()
    {
        var master = CreateMasterProvider("srv", "Db1");
        var factory = CreateFactory(master);

        var schema = CreateMockAnalyzer("Schema"); // PascalCase
        var orchestrator = new ServerAnalysisOrchestrator([schema], factory);

        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["SCHEMA"]); // UPPER CASE

        await schema.Received(1).AnalyzeAsync(Arg.Any<IDbProvider>(), Arg.Any<AnalysisResult>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task RunAsync_MergesSchemaAcrossDatabases_WithDatabaseNameStamped()
    {
        var master = CreateMasterProvider("srv", "Sales", "HR");
        var factory = CreateFactory(master);

        var schema = CreateMockAnalyzer("schema", (provider, result) =>
        {
            result.Schema = new DatabaseSchema
            {
                Tables = [new TableInfo("dbo", "Orders", [], [], [])],
                Views = [new ViewInfo("dbo", "vOrders", "SELECT 1", [])]
            };
        });
        var orchestrator = new ServerAnalysisOrchestrator([schema], factory);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["schema"]);

        // Tables from both databases, stamped with DatabaseName
        Assert.Equal(2, result.Schema!.Tables.Count);
        Assert.Equal("Sales", result.Schema.Tables[0].DatabaseName);
        Assert.Equal("HR", result.Schema.Tables[1].DatabaseName);

        // Views
        Assert.Equal(2, result.Schema.Views.Count);
        Assert.Equal("Sales", result.Schema.Views[0].DatabaseName);
        Assert.Equal("HR", result.Schema.Views[1].DatabaseName);
    }

    [Fact]
    public async Task RunAsync_MergesProfiles_WithDatabaseNameStamped()
    {
        var master = CreateMasterProvider("srv", "App");
        var factory = CreateFactory(master);

        var profiling = CreateMockAnalyzer("profiling", (_, result) =>
        {
            result.Profiles =
            [
                new TableProfile { SchemaName = "dbo", TableName = "Users", RowCount = 100 }
            ];
        });
        var orchestrator = new ServerAnalysisOrchestrator([profiling], factory);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["profiling"]);

        Assert.NotNull(result.Profiles);
        Assert.Single(result.Profiles);
        Assert.Equal("App", result.Profiles[0].DatabaseName);
        Assert.Equal("Users", result.Profiles[0].TableName);
    }

    [Fact]
    public async Task RunAsync_MergesExplicitRelationships_WithDatabaseNameStamped()
    {
        var master = CreateMasterProvider("srv", "Shop");
        var factory = CreateFactory(master);

        var rel = CreateMockAnalyzer("relationships", (_, result) =>
        {
            result.Relationships = new RelationshipMap
            {
                ExplicitRelationships =
                [
                    new ForeignKeyInfo("FK_Order_Customer", "dbo", "Orders", "CustomerId", "dbo", "Customers", "Id", "NO ACTION", "NO ACTION")
                ]
            };
        });
        var orchestrator = new ServerAnalysisOrchestrator([rel], factory);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["relationships"]);

        var fk = Assert.Single(result.Relationships!.ExplicitRelationships);
        Assert.Equal("Shop", fk.FromDatabase);
        Assert.Equal("Shop", fk.ToDatabase);
    }

    [Fact]
    public async Task RunAsync_MergesImplicitRelationships_WithDatabaseNameStamped()
    {
        var master = CreateMasterProvider("srv", "Db1");
        var factory = CreateFactory(master);

        var rel = CreateMockAnalyzer("relationships", (_, result) =>
        {
            result.Relationships = new RelationshipMap
            {
                ImplicitRelationships =
                [
                    new ImplicitRelationship("dbo", "Orders", "UserId", "dbo", "Users", "Id", 0.95, "Name match")
                ]
            };
        });
        var orchestrator = new ServerAnalysisOrchestrator([rel], factory);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["relationships"]);

        var imp = Assert.Single(result.Relationships!.ImplicitRelationships);
        Assert.Equal("Db1", imp.FromDatabase);
        Assert.Equal("Db1", imp.ToDatabase);
    }

    [Fact]
    public async Task RunAsync_MergesDependencies_QualifiesNames()
    {
        var master = CreateMasterProvider("srv", "App");
        var factory = CreateFactory(master);

        var rel = CreateMockAnalyzer("relationships", (_, result) =>
        {
            result.Relationships = new RelationshipMap
            {
                Dependencies =
                [
                    new TableDependency
                    {
                        SchemaName = "dbo",
                        TableName = "Orders",
                        DependsOn = ["dbo.Customers"],           // 2-part → should become 3-part
                        ReferencedBy = ["App.dbo.LineItems"],    // 3-part → stays as-is
                        TransitiveImpact = ["dbo.Invoices"]
                    }
                ]
            };
        });
        var orchestrator = new ServerAnalysisOrchestrator([rel], factory);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["relationships"]);

        var dep = Assert.Single(result.Relationships!.Dependencies);
        Assert.Equal("App", dep.DatabaseName);
        Assert.Equal(["App.dbo.Customers"], dep.DependsOn);
        Assert.Equal(["App.dbo.LineItems"], dep.ReferencedBy); // already 3-part, unchanged
        Assert.Equal(["App.dbo.Invoices"], dep.TransitiveImpact);
    }

    [Fact]
    public async Task RunAsync_ResolvesCrossDatabaseReferences()
    {
        var master = CreateMasterProvider("srv", "Sales", "Shared");
        var factory = CreateFactory(master);

        var rel = CreateMockAnalyzer("relationships", (provider, result) =>
        {
            var dbName = provider.DatabaseName;
            if (dbName == "Sales")
            {
                result.Relationships = new RelationshipMap
                {
                    Dependencies =
                    [
                        new TableDependency
                        {
                            SchemaName = "dbo",
                            TableName = "Orders",
                            ExternalDatabase = "Shared" // points to another analyzed DB
                        }
                    ]
                };
            }
            else
            {
                result.Relationships = new RelationshipMap();
            }
        });

        // Provide distinct providers per database so the analyzer sees the correct DatabaseName
        var salesProvider = CreateDbProvider("Sales");
        var sharedProvider = CreateDbProvider("Shared");
        var dbProviders = new Dictionary<string, IDbProvider>
        {
            ["Sales"] = salesProvider,
            ["Shared"] = sharedProvider
        };
        var masterProvider = CreateMasterProvider("srv", "Sales", "Shared");
        var factoryWithProviders = CreateFactory(masterProvider, dbProviders);

        var orchestrator = new ServerAnalysisOrchestrator([rel], factoryWithProviders);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["relationships"]);

        // ExternalDatabase should be cleared because "Shared" is in the analyzed set
        var dep = Assert.Single(result.Relationships!.Dependencies);
        Assert.Null(dep.ExternalDatabase);
    }

    [Fact]
    public async Task RunAsync_ProgressCallbackIsCalled()
    {
        var master = CreateMasterProvider("srv", "Db1", "Db2");
        var factory = CreateFactory(master);
        var orchestrator = new ServerAnalysisOrchestrator([], factory);

        var progressCalls = new List<(string Step, int Current, int Total, string Status)>();

        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["schema"],
            async (step, current, total, status) =>
            {
                progressCalls.Add((step, current, total, status));
                await Task.CompletedTask;
            });

        // Each DB gets "Analyzing..." (running) and "Analyzed..." (completed) = 4 calls total
        Assert.Equal(4, progressCalls.Count);

        Assert.Equal("Analyzing Db1", progressCalls[0].Step);
        Assert.Equal("running", progressCalls[0].Status);
        Assert.Equal(1, progressCalls[0].Current);
        Assert.Equal(2, progressCalls[0].Total);

        Assert.Equal("Analyzed Db1", progressCalls[1].Step);
        Assert.Equal("completed", progressCalls[1].Status);

        Assert.Equal("Analyzing Db2", progressCalls[2].Step);
        Assert.Equal("Analyzed Db2", progressCalls[3].Step);
    }

    [Fact]
    public async Task RunAsync_Cancellation_ThrowsOperationCanceled()
    {
        var master = CreateMasterProvider("srv", "Db1", "Db2");
        var factory = CreateFactory(master);
        var orchestrator = new ServerAnalysisOrchestrator([], factory);

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            orchestrator.RunAsync(
                "Server=srv;Initial Catalog=master",
                ["schema"],
                ct: cts.Token));
    }

    [Fact]
    public async Task RunAsync_ConnectionString_SetsMasterForEnumeration()
    {
        // Verify the orchestrator connects to master for enumeration,
        // regardless of what Initial Catalog is in the input connection string
        string? capturedConnectionString = null;
        var master = CreateMasterProvider("srv", "MyDb");

        Func<string, CancellationToken, Task<IDbProvider>> factory = (connStr, ct) =>
        {
            var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connStr);
            if (builder.InitialCatalog == "master")
            {
                capturedConnectionString = connStr;
                return Task.FromResult(master);
            }
            return Task.FromResult(CreateDbProvider(builder.InitialCatalog));
        };

        var orchestrator = new ServerAnalysisOrchestrator([], factory);
        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=SomeOtherDb",
            ["schema"]);

        Assert.NotNull(capturedConnectionString);
        var parsed = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(capturedConnectionString!);
        Assert.Equal("master", parsed.InitialCatalog);
    }

    [Fact]
    public async Task RunAsync_PerDatabaseConnection_SetsCorrectInitialCatalog()
    {
        var master = CreateMasterProvider("srv", "Alpha", "Beta");
        var capturedCatalogs = new List<string>();

        Func<string, CancellationToken, Task<IDbProvider>> factory = (connStr, ct) =>
        {
            var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connStr);
            capturedCatalogs.Add(builder.InitialCatalog);

            if (builder.InitialCatalog == "master")
                return Task.FromResult(master);

            return Task.FromResult(CreateDbProvider(builder.InitialCatalog));
        };

        var orchestrator = new ServerAnalysisOrchestrator([], factory);
        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["schema"]);

        // master + Alpha + Beta
        Assert.Equal(["master", "Alpha", "Beta"], capturedCatalogs);
    }

    [Fact]
    public async Task RunAsync_MergesQualityIssues()
    {
        var master = CreateMasterProvider("srv", "Db1");
        var factory = CreateFactory(master);

        var quality = CreateMockAnalyzer("quality", (_, result) =>
        {
            result.QualityIssues =
            [
                new QualityIssue("Naming", IssueSeverity.Warning, "dbo.Foo", "Bad name", "Rename it")
            ];
        });
        var orchestrator = new ServerAnalysisOrchestrator([quality], factory);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["quality"]);

        Assert.Single(result.QualityIssues!);
        Assert.Equal("Bad name", result.QualityIssues![0].Description);
    }

    [Fact]
    public async Task RunAsync_MergesUsageAnalysis()
    {
        var master = CreateMasterProvider("srv", "Db1");
        var factory = CreateFactory(master);

        var usage = CreateMockAnalyzer("usage", (_, result) =>
        {
            result.UsageAnalysis = new UsageAnalysis
            {
                ServerStartTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                ServerUptimeDays = 50
            };
        });
        var orchestrator = new ServerAnalysisOrchestrator([usage], factory);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["usage"]);

        Assert.Equal(50, result.UsageAnalysis!.ServerUptimeDays);
        Assert.Equal(new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), result.UsageAnalysis.ServerStartTime);
    }

    [Fact]
    public async Task RunAsync_MultipleAnalyzers_AllRunPerDatabase()
    {
        var master = CreateMasterProvider("srv", "Db1");
        var factory = CreateFactory(master);

        var callOrder = new List<string>();
        var schema = CreateMockAnalyzer("schema", (_, _) => callOrder.Add("schema"));
        var profiling = CreateMockAnalyzer("profiling", (_, _) => callOrder.Add("profiling"));
        var orchestrator = new ServerAnalysisOrchestrator([schema, profiling], factory);

        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["schema", "profiling"]);

        Assert.Equal(["schema", "profiling"], callOrder);
    }
}

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
    /// Creates a mock IDbProvider with the given server and database name.
    /// </summary>
    private static IDbProvider CreateProvider(string serverName, string databaseName = "master")
    {
        var provider = Substitute.For<IDbProvider>();
        provider.ServerName.Returns(serverName);
        provider.DatabaseName.Returns(databaseName);
        return provider;
    }

    /// <summary>
    /// Creates a mock IProviderBundle that returns the given database names
    /// from ServerQueries.EnumerateDatabasesAsync, and creates mock providers per database.
    /// </summary>
    private static IProviderBundle CreateBundle(
        string serverName,
        string[] databaseNames,
        Dictionary<string, IDbProvider>? dbProviders = null)
    {
        var masterProvider = CreateProvider(serverName, "master");

        var factory = Substitute.For<IDbProviderFactory>();
        factory.ProviderType.Returns("sqlserver");
        factory.DefaultSystemDatabase.Returns("master");

        factory.SetDatabase(Arg.Any<string>(), Arg.Any<string>())
            .Returns(callInfo => $"Server={serverName};Database={callInfo.ArgAt<string>(1)}");

        factory.CreateAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(callInfo =>
            {
                var connStr = callInfo.ArgAt<string>(0);
                var match = System.Text.RegularExpressions.Regex.Match(connStr, @"Database=([^;]+)");
                var catalog = match.Success ? match.Groups[1].Value : "master";

                if (string.Equals(catalog, "master", StringComparison.OrdinalIgnoreCase))
                    return Task.FromResult(masterProvider);

                if (dbProviders?.TryGetValue(catalog, out var p) == true)
                    return Task.FromResult(p);

                return Task.FromResult(CreateProvider(serverName, catalog));
            });

        var serverQueries = Substitute.For<IServerQueries>();
        serverQueries.EnumerateDatabasesAsync(Arg.Any<IDbProvider>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(databaseNames.ToList()));

        var bundle = Substitute.For<IProviderBundle>();
        bundle.ProviderType.Returns("sqlserver");
        bundle.Factory.Returns(factory);
        bundle.ServerQueries.Returns(serverQueries);
        bundle.CatalogQueries.Returns(Substitute.For<ICatalogQueries>());
        bundle.PerformanceQueries.Returns(Substitute.For<IPerformanceQueries>());

        return bundle;
    }

    /// <summary>
    /// Creates a bundle whose factory throws when connecting to a specific database.
    /// </summary>
    private static IProviderBundle CreateBundleWithFailure(
        string serverName,
        string[] databaseNames,
        string failingDatabase)
    {
        var masterProvider = CreateProvider(serverName, "master");

        var factory = Substitute.For<IDbProviderFactory>();
        factory.ProviderType.Returns("sqlserver");
        factory.DefaultSystemDatabase.Returns("master");

        factory.SetDatabase(Arg.Any<string>(), Arg.Any<string>())
            .Returns(callInfo => $"Server={serverName};Database={callInfo.ArgAt<string>(1)}");

        factory.CreateAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(callInfo =>
            {
                var connStr = callInfo.ArgAt<string>(0);
                var match = System.Text.RegularExpressions.Regex.Match(connStr, @"Database=([^;]+)");
                var catalog = match.Success ? match.Groups[1].Value : "master";

                if (string.Equals(catalog, failingDatabase, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException($"Cannot connect to database '{catalog}'");

                if (string.Equals(catalog, "master", StringComparison.OrdinalIgnoreCase))
                    return Task.FromResult(masterProvider);

                return Task.FromResult(CreateProvider(serverName, catalog));
            });

        var serverQueries = Substitute.For<IServerQueries>();
        serverQueries.EnumerateDatabasesAsync(Arg.Any<IDbProvider>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(databaseNames.ToList()));

        var bundle = Substitute.For<IProviderBundle>();
        bundle.ProviderType.Returns("sqlserver");
        bundle.Factory.Returns(factory);
        bundle.ServerQueries.Returns(serverQueries);
        bundle.CatalogQueries.Returns(Substitute.For<ICatalogQueries>());
        bundle.PerformanceQueries.Returns(Substitute.For<IPerformanceQueries>());

        return bundle;
    }

    private static IAnalyzer CreateMockAnalyzer(string name, Action<AnalysisContext, AnalysisResult>? onAnalyze = null)
    {
        var analyzer = Substitute.For<IAnalyzer>();
        analyzer.Name.Returns(name);
        analyzer.AnalyzeAsync(Arg.Any<AnalysisContext>(), Arg.Any<AnalysisResult>(), Arg.Any<CancellationToken>())
            .Returns(callInfo =>
            {
                onAnalyze?.Invoke(callInfo.ArgAt<AnalysisContext>(0), callInfo.ArgAt<AnalysisResult>(1));
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
        var bundle = CreateBundle("myserver", ["DbA", "DbB"]);
        var orchestrator = new ServerAnalysisOrchestrator([], bundle);

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
        var bundle = CreateBundle("myserver", []);
        var orchestrator = new ServerAnalysisOrchestrator([], bundle);

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
        var bundle = CreateBundleWithFailure("myserver", ["GoodDb", "BadDb", "GoodDb2"], "BadDb");

        var schemaAnalyzer = CreateMockAnalyzer("schema");
        var orchestrator = new ServerAnalysisOrchestrator([schemaAnalyzer], bundle);

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
        var bundle = CreateBundle("srv", ["Db1"]);

        var schema = CreateMockAnalyzer("Schema");
        var profiling = CreateMockAnalyzer("Profiling");
        var orchestrator = new ServerAnalysisOrchestrator([schema, profiling], bundle);

        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["schema"]); // Only request schema, not profiling

        await schema.Received(1).AnalyzeAsync(Arg.Any<AnalysisContext>(), Arg.Any<AnalysisResult>(), Arg.Any<CancellationToken>());
        await profiling.DidNotReceive().AnalyzeAsync(Arg.Any<AnalysisContext>(), Arg.Any<AnalysisResult>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task RunAsync_AnalyzerNameMatching_IsCaseInsensitive()
    {
        var bundle = CreateBundle("srv", ["Db1"]);

        var schema = CreateMockAnalyzer("Schema"); // PascalCase
        var orchestrator = new ServerAnalysisOrchestrator([schema], bundle);

        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["SCHEMA"]); // UPPER CASE

        await schema.Received(1).AnalyzeAsync(Arg.Any<AnalysisContext>(), Arg.Any<AnalysisResult>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task RunAsync_MergesSchemaAcrossDatabases_WithDatabaseNameStamped()
    {
        var bundle = CreateBundle("srv", ["Sales", "HR"]);

        var schema = CreateMockAnalyzer("schema", (_, result) =>
        {
            result.Schema = new DatabaseSchema
            {
                Tables = [new TableInfo("dbo", "Orders", [], [], [])],
                Views = [new ViewInfo("dbo", "vOrders", "SELECT 1", [])]
            };
        });
        var orchestrator = new ServerAnalysisOrchestrator([schema], bundle);

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
        var bundle = CreateBundle("srv", ["App"]);

        var profiling = CreateMockAnalyzer("profiling", (_, result) =>
        {
            result.Profiles =
            [
                new TableProfile { SchemaName = "dbo", TableName = "Users", RowCount = 100 }
            ];
        });
        var orchestrator = new ServerAnalysisOrchestrator([profiling], bundle);

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
        var bundle = CreateBundle("srv", ["Shop"]);

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
        var orchestrator = new ServerAnalysisOrchestrator([rel], bundle);

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
        var bundle = CreateBundle("srv", ["Db1"]);

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
        var orchestrator = new ServerAnalysisOrchestrator([rel], bundle);

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
        var bundle = CreateBundle("srv", ["App"]);

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
                        DependsOn = ["dbo.Customers"],           // 2-part -> should become 3-part
                        ReferencedBy = ["App.dbo.LineItems"],    // 3-part -> stays as-is
                        TransitiveImpact = ["dbo.Invoices"]
                    }
                ]
            };
        });
        var orchestrator = new ServerAnalysisOrchestrator([rel], bundle);

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
        var salesProvider = CreateProvider("srv", "Sales");
        var sharedProvider = CreateProvider("srv", "Shared");
        var dbProviders = new Dictionary<string, IDbProvider>
        {
            ["Sales"] = salesProvider,
            ["Shared"] = sharedProvider
        };
        var bundle = CreateBundle("srv", ["Sales", "Shared"], dbProviders);

        var rel = CreateMockAnalyzer("relationships", (context, result) =>
        {
            var dbName = context.Provider.DatabaseName;
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

        var orchestrator = new ServerAnalysisOrchestrator([rel], bundle);

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
        var bundle = CreateBundle("srv", ["Db1", "Db2"]);
        var orchestrator = new ServerAnalysisOrchestrator([], bundle);

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
        var bundle = CreateBundle("srv", ["Db1", "Db2"]);
        var orchestrator = new ServerAnalysisOrchestrator([], bundle);

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            orchestrator.RunAsync(
                "Server=srv;Initial Catalog=master",
                ["schema"],
                ct: cts.Token));
    }

    [Fact]
    public async Task RunAsync_UsesFactorySetDatabase_ForSystemDb()
    {
        // Verify the orchestrator calls Factory.SetDatabase to switch to the system database
        var bundle = CreateBundle("srv", ["MyDb"]);
        var orchestrator = new ServerAnalysisOrchestrator([], bundle);

        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=SomeOtherDb",
            ["schema"]);

        bundle.Factory.Received().SetDatabase(
            "Server=srv;Initial Catalog=SomeOtherDb",
            "master");
    }

    [Fact]
    public async Task RunAsync_UsesFactorySetDatabase_ForEachDatabase()
    {
        var bundle = CreateBundle("srv", ["Alpha", "Beta"]);
        var orchestrator = new ServerAnalysisOrchestrator([], bundle);

        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["schema"]);

        // SetDatabase should have been called for master + Alpha + Beta
        bundle.Factory.Received().SetDatabase(Arg.Any<string>(), "master");
        bundle.Factory.Received().SetDatabase(Arg.Any<string>(), "Alpha");
        bundle.Factory.Received().SetDatabase(Arg.Any<string>(), "Beta");
    }

    [Fact]
    public async Task RunAsync_MergesQualityIssues()
    {
        var bundle = CreateBundle("srv", ["Db1"]);

        var quality = CreateMockAnalyzer("quality", (_, result) =>
        {
            result.QualityIssues =
            [
                new QualityIssue("Naming", IssueSeverity.Warning, "dbo.Foo", "Bad name", "Rename it")
            ];
        });
        var orchestrator = new ServerAnalysisOrchestrator([quality], bundle);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["quality"]);

        Assert.Single(result.QualityIssues!);
        Assert.Equal("Bad name", result.QualityIssues![0].Description);
    }

    [Fact]
    public async Task RunAsync_MergesUsageAnalysis()
    {
        var bundle = CreateBundle("srv", ["Db1"]);

        var usage = CreateMockAnalyzer("usage", (_, result) =>
        {
            result.UsageAnalysis = new UsageAnalysis
            {
                ServerStartTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                ServerUptimeDays = 50
            };
        });
        var orchestrator = new ServerAnalysisOrchestrator([usage], bundle);

        var result = await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["usage"]);

        Assert.Equal(50, result.UsageAnalysis!.ServerUptimeDays);
        Assert.Equal(new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), result.UsageAnalysis.ServerStartTime);
    }

    [Fact]
    public async Task RunAsync_MultipleAnalyzers_AllRunPerDatabase()
    {
        var bundle = CreateBundle("srv", ["Db1"]);

        var callOrder = new List<string>();
        var schema = CreateMockAnalyzer("schema", (_, _) => callOrder.Add("schema"));
        var profiling = CreateMockAnalyzer("profiling", (_, _) => callOrder.Add("profiling"));
        var orchestrator = new ServerAnalysisOrchestrator([schema, profiling], bundle);

        await orchestrator.RunAsync(
            "Server=srv;Initial Catalog=master",
            ["schema", "profiling"]);

        Assert.Equal(["schema", "profiling"], callOrder);
    }
}

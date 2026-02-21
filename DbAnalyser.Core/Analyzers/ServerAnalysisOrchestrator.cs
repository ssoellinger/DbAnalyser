using DbAnalyser.Models.Profiling;
using DbAnalyser.Models.Quality;
using DbAnalyser.Models.Relationships;
using DbAnalyser.Models.Schema;
using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;
using DbAnalyser.Providers.SqlServer;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbAnalyser.Analyzers;

public class ServerAnalysisOrchestrator
{
    private readonly IEnumerable<IAnalyzer> _analyzers;
    private readonly ILogger<ServerAnalysisOrchestrator> _logger;
    private readonly Func<string, CancellationToken, Task<IDbProvider>> _providerFactory;

    public ServerAnalysisOrchestrator(IEnumerable<IAnalyzer> analyzers)
        : this(analyzers, NullLogger<ServerAnalysisOrchestrator>.Instance)
    {
    }

    public ServerAnalysisOrchestrator(IEnumerable<IAnalyzer> analyzers, ILogger<ServerAnalysisOrchestrator> logger)
        : this(analyzers, logger, DefaultProviderFactory)
    {
    }

    public ServerAnalysisOrchestrator(
        IEnumerable<IAnalyzer> analyzers,
        Func<string, CancellationToken, Task<IDbProvider>> providerFactory)
        : this(analyzers, NullLogger<ServerAnalysisOrchestrator>.Instance, providerFactory)
    {
    }

    public ServerAnalysisOrchestrator(
        IEnumerable<IAnalyzer> analyzers,
        ILogger<ServerAnalysisOrchestrator> logger,
        Func<string, CancellationToken, Task<IDbProvider>> providerFactory)
    {
        _analyzers = analyzers;
        _logger = logger;
        _providerFactory = providerFactory;
    }

    private static async Task<IDbProvider> DefaultProviderFactory(string connectionString, CancellationToken ct)
    {
        var provider = new SqlServerProvider();
        await provider.ConnectAsync(connectionString, ct);
        return provider;
    }

    public async Task<AnalysisResult> RunAsync(
        string connectionString,
        List<string> analyzerNames,
        Func<string, int, int, string, Task>? onProgress = null,
        CancellationToken ct = default)
    {
        // 1. Enumerate user databases using a temporary connection to master
        var masterBuilder = new SqlConnectionStringBuilder(connectionString)
        {
            InitialCatalog = "master"
        };
        List<string> databases;
        string serverName;
        await using (var masterProvider = await _providerFactory(masterBuilder.ConnectionString, ct))
        {
            serverName = masterProvider.ServerName;
            databases = await EnumerateDatabasesAsync(masterProvider, ct);
        }

        _logger.LogInformation("Server analysis started on {Server} — found {Count} databases: [{Databases}]",
            serverName, databases.Count, string.Join(", ", databases));

        var enabledNames = analyzerNames.Select(a => a.ToLowerInvariant()).ToHashSet();

        var merged = new AnalysisResult
        {
            DatabaseName = serverName,
            AnalyzedAt = DateTime.UtcNow,
            IsServerMode = true,
            Databases = [],
        };

        // Only initialize sections for analyzers that will actually run
        if (enabledNames.Contains("schema"))
            merged.Schema = new DatabaseSchema { DatabaseName = serverName };
        if (enabledNames.Contains("profiling"))
            merged.Profiles = [];
        if (enabledNames.Contains("relationships"))
            merged.Relationships = new RelationshipMap();
        if (enabledNames.Contains("quality"))
            merged.QualityIssues = [];
        if (enabledNames.Contains("usage"))
            merged.UsageAnalysis = new UsageAnalysis();
        var analyzerInstances = _analyzers
            .Where(a => enabledNames.Contains(a.Name.ToLowerInvariant()))
            .ToList();

        // 2. For each database, create a new connection and run analyzers
        for (var i = 0; i < databases.Count; i++)
        {
            var dbName = databases[i];
            ct.ThrowIfCancellationRequested();

            try
            {
                if (onProgress is not null)
                    await onProgress($"Analyzing {dbName}", i + 1, databases.Count, "running");

                var dbBuilder = new SqlConnectionStringBuilder(connectionString)
                {
                    InitialCatalog = dbName
                };

                await using var dbProvider = await _providerFactory(dbBuilder.ConnectionString, ct);

                var dbResult = new AnalysisResult
                {
                    DatabaseName = dbName,
                    AnalyzedAt = DateTime.UtcNow
                };

                foreach (var analyzer in analyzerInstances)
                {
                    await analyzer.AnalyzeAsync(dbProvider, dbResult, ct);
                }

                // 3. Merge into unified result, stamping DatabaseName
                MergeResult(merged, dbResult, dbName);
                merged.Databases.Add(dbName);

                if (onProgress is not null)
                    await onProgress($"Analyzed {dbName}", i + 1, databases.Count, "completed");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to analyze database {Database}", dbName);
                merged.FailedDatabases.Add(new DatabaseError(dbName, ex.Message));
            }
        }

        // 4. Post-merge: resolve cross-database external references
        ResolveCrossDatabaseReferences(merged);

        _logger.LogInformation("Server analysis completed — {Succeeded} succeeded, {Failed} failed",
            merged.Databases.Count, merged.FailedDatabases.Count);

        return merged;
    }

    private static async Task<List<string>> EnumerateDatabasesAsync(IDbProvider provider, CancellationToken ct)
    {
        // HAS_DBACCESS is omitted: on Azure SQL it returns 0 from master context
        // even when the login has access. Inaccessible databases will fail at
        // connection time and land in FailedDatabases instead.
        const string sql = """
            SELECT name FROM sys.databases
            WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
              AND state_desc = 'ONLINE'
            ORDER BY name
            """;

        var table = await provider.ExecuteQueryAsync(sql, ct);
        var databases = new List<string>();
        foreach (System.Data.DataRow row in table.Rows)
        {
            databases.Add(row["name"].ToString()!);
        }
        return databases;
    }

    private static void MergeResult(AnalysisResult merged, AnalysisResult dbResult, string dbName)
    {
        // Schema
        if (dbResult.Schema is not null && merged.Schema is not null)
        {
            merged.Schema.Tables.AddRange(
                dbResult.Schema.Tables.Select(t => t with { DatabaseName = dbName }));
            merged.Schema.Views.AddRange(
                dbResult.Schema.Views.Select(v => v with { DatabaseName = dbName }));
            merged.Schema.StoredProcedures.AddRange(
                dbResult.Schema.StoredProcedures.Select(sp => sp with { DatabaseName = dbName }));
            merged.Schema.Functions.AddRange(
                dbResult.Schema.Functions.Select(f => f with { DatabaseName = dbName }));
            merged.Schema.Triggers.AddRange(
                dbResult.Schema.Triggers.Select(t => t with { DatabaseName = dbName }));
            merged.Schema.Synonyms.AddRange(
                dbResult.Schema.Synonyms.Select(s => s with { DatabaseName = dbName }));
            merged.Schema.Sequences.AddRange(
                dbResult.Schema.Sequences.Select(s => s with { DatabaseName = dbName }));
            merged.Schema.UserDefinedTypes.AddRange(
                dbResult.Schema.UserDefinedTypes.Select(u => u with { DatabaseName = dbName }));
            merged.Schema.Jobs.AddRange(dbResult.Schema.Jobs);
        }

        // Profiling
        if (dbResult.Profiles is not null && merged.Profiles is not null)
        {
            foreach (var p in dbResult.Profiles)
            {
                p.DatabaseName = dbName;
            }
            merged.Profiles.AddRange(dbResult.Profiles);
        }

        // Relationships
        if (dbResult.Relationships is not null && merged.Relationships is not null)
        {
            merged.Relationships.ExplicitRelationships.AddRange(
                dbResult.Relationships.ExplicitRelationships.Select(fk => fk with
                {
                    FromDatabase = dbName,
                    ToDatabase = fk.ToDatabase ?? dbName
                }));

            merged.Relationships.ImplicitRelationships.AddRange(
                dbResult.Relationships.ImplicitRelationships.Select(r => r with
                {
                    FromDatabase = dbName,
                    ToDatabase = r.ToDatabase ?? dbName
                }));

            foreach (var dep in dbResult.Relationships.Dependencies)
            {
                dep.DatabaseName = dbName;
                // Rewrite DependsOn/ReferencedBy/TransitiveImpact to use 3-part names
                dep.DependsOn = dep.DependsOn.Select(n => QualifyName(n, dbName)).ToList();
                dep.ReferencedBy = dep.ReferencedBy.Select(n => QualifyName(n, dbName)).ToList();
                dep.TransitiveImpact = dep.TransitiveImpact.Select(n => QualifyName(n, dbName)).ToList();
            }
            merged.Relationships.Dependencies.AddRange(dbResult.Relationships.Dependencies);

            merged.Relationships.ViewDependencies.AddRange(
                dbResult.Relationships.ViewDependencies.Select(d => d with
                {
                    FromDatabase = dbName,
                    ToDatabase = d.ToDatabase ?? dbName
                }));
        }

        // Quality
        if (dbResult.QualityIssues is not null && merged.QualityIssues is not null)
        {
            merged.QualityIssues.AddRange(dbResult.QualityIssues);
        }

        // Usage
        if (dbResult.UsageAnalysis is not null && merged.UsageAnalysis is not null)
        {
            merged.UsageAnalysis.Objects.AddRange(dbResult.UsageAnalysis.Objects);
            merged.UsageAnalysis.ServerStartTime ??= dbResult.UsageAnalysis.ServerStartTime;
            merged.UsageAnalysis.ServerUptimeDays ??= dbResult.UsageAnalysis.ServerUptimeDays;
        }
    }

    /// <summary>
    /// Qualify a 2-part name (schema.object) into a 3-part name (db.schema.object).
    /// If the name already has 3+ parts, leave it as-is.
    /// </summary>
    private static string QualifyName(string name, string dbName)
    {
        var dotCount = name.Count(c => c == '.');
        return dotCount >= 2 ? name : $"{dbName}.{name}";
    }

    /// <summary>
    /// Post-merge: resolve cross-database external references.
    /// External TableDependencies whose target DB is in our analyzed set
    /// are no longer truly external.
    /// </summary>
    private static void ResolveCrossDatabaseReferences(AnalysisResult merged)
    {
        if (merged.Relationships is null) return;

        var analyzedDbs = new HashSet<string>(merged.Databases, StringComparer.OrdinalIgnoreCase);

        // For external TableDependencies pointing to an analyzed DB, clear ExternalDatabase
        foreach (var dep in merged.Relationships.Dependencies)
        {
            if (dep.ExternalDatabase is not null && analyzedDbs.Contains(dep.ExternalDatabase))
            {
                dep.ExternalDatabase = null;
            }
        }
    }
}

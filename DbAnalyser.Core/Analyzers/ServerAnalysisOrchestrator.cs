using DbAnalyser.Models.Indexing;
using DbAnalyser.Models.Profiling;
using DbAnalyser.Models.Quality;
using DbAnalyser.Models.Relationships;
using DbAnalyser.Models.Schema;
using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbAnalyser.Analyzers;

public class ServerAnalysisOrchestrator
{
    private readonly IEnumerable<IAnalyzer> _analyzers;
    private readonly ILogger<ServerAnalysisOrchestrator> _logger;
    private readonly IProviderBundle _bundle;

    public ServerAnalysisOrchestrator(IEnumerable<IAnalyzer> analyzers, IProviderBundle bundle)
        : this(analyzers, bundle, NullLogger<ServerAnalysisOrchestrator>.Instance)
    {
    }

    public ServerAnalysisOrchestrator(
        IEnumerable<IAnalyzer> analyzers,
        IProviderBundle bundle,
        ILogger<ServerAnalysisOrchestrator> logger)
    {
        _analyzers = analyzers;
        _bundle = bundle;
        _logger = logger;
    }

    public async Task<AnalysisResult> RunAsync(
        string connectionString,
        List<string> analyzerNames,
        Func<string, int, int, string, Task>? onProgress = null,
        CancellationToken ct = default)
    {
        // 1. Enumerate user databases using a temporary connection to the system database
        var masterConnStr = _bundle.Factory.SetDatabase(connectionString, _bundle.Factory.DefaultSystemDatabase);
        List<string> databases;
        string serverName;
        await using (var masterProvider = await _bundle.Factory.CreateAsync(masterConnStr, ct))
        {
            serverName = masterProvider.ServerName;
            databases = await _bundle.ServerQueries.EnumerateDatabasesAsync(masterProvider, ct);
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
        if (enabledNames.Contains("indexing"))
        {
            merged.IndexRecommendations = [];
            merged.IndexInventory = [];
        }
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

                var dbConnStr = _bundle.Factory.SetDatabase(connectionString, dbName);
                await using var dbProvider = await _bundle.Factory.CreateAsync(dbConnStr, ct);

                var context = new AnalysisContext
                {
                    Provider = dbProvider,
                    CatalogQueries = _bundle.CatalogQueries,
                    PerformanceQueries = _bundle.PerformanceQueries,
                    ServerQueries = _bundle.ServerQueries,
                    ProviderType = _bundle.ProviderType
                };

                var dbResult = new AnalysisResult
                {
                    DatabaseName = dbName,
                    AnalyzedAt = DateTime.UtcNow
                };

                foreach (var analyzer in analyzerInstances)
                {
                    await analyzer.AnalyzeAsync(context, dbResult, ct);
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

        // Indexing
        if (dbResult.IndexRecommendations is not null && merged.IndexRecommendations is not null)
        {
            merged.IndexRecommendations.AddRange(
                dbResult.IndexRecommendations.Select(r => r with { DatabaseName = dbName }));
        }
        if (dbResult.IndexInventory is not null && merged.IndexInventory is not null)
        {
            merged.IndexInventory.AddRange(
                dbResult.IndexInventory.Select(r => r with { DatabaseName = dbName }));
        }
    }

    private static string QualifyName(string name, string dbName)
    {
        var dotCount = name.Count(c => c == '.');
        return dotCount >= 2 ? name : $"{dbName}.{name}";
    }

    private static void ResolveCrossDatabaseReferences(AnalysisResult merged)
    {
        if (merged.Relationships is null) return;

        var analyzedDbs = new HashSet<string>(merged.Databases, StringComparer.OrdinalIgnoreCase);

        foreach (var dep in merged.Relationships.Dependencies)
        {
            if (dep.ExternalDatabase is not null && analyzedDbs.Contains(dep.ExternalDatabase))
            {
                dep.ExternalDatabase = null;
            }
        }
    }
}

using System.Collections.Concurrent;
using DbAnalyser.Analyzers;
using DbAnalyser.Api.Hubs;
using DbAnalyser.Configuration;
using DbAnalyser.Models.Schema;
using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;

namespace DbAnalyser.Api.Services;

public class AnalysisSessionService : IAsyncDisposable
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IHubContext<AnalysisHub> _hubContext;
    private readonly ILogger<AnalysisSessionService> _logger;
    private readonly ProviderRegistry _registry;
    private readonly ConcurrentDictionary<string, SessionState> _sessions = new();
    private readonly Timer _cleanupTimer;
    private static readonly TimeSpan CleanupInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan SessionIdleTimeout = TimeSpan.FromMinutes(30);

    public AnalysisSessionService(
        IServiceProvider serviceProvider,
        IHubContext<AnalysisHub> hubContext,
        ILogger<AnalysisSessionService> logger,
        ProviderRegistry registry)
    {
        _serviceProvider = serviceProvider;
        _hubContext = hubContext;
        _logger = logger;
        _registry = registry;
        _cleanupTimer = new Timer(_ => CleanupIdleSessions(), null, CleanupInterval, CleanupInterval);
    }

    private void CleanupIdleSessions()
    {
        var cutoff = DateTime.UtcNow - SessionIdleTimeout;
        foreach (var (id, session) in _sessions)
        {
            if (session.LastActivityUtc < cutoff && _sessions.TryRemove(id, out var removed))
            {
                _logger.LogInformation("Cleaning up idle session {SessionId} (last activity: {LastActivity})",
                    id, removed.LastActivityUtc);
                removed.Provider.DisposeAsync().AsTask().ContinueWith(t =>
                {
                    if (t.IsFaulted)
                        _logger.LogWarning(t.Exception, "Error disposing idle session {SessionId}", id);
                });
            }
        }
    }

    public async Task<ConnectResult> ConnectAsync(string connectionString, string providerType = "sqlserver", CancellationToken ct = default)
    {
        var bundle = _registry.GetBundle(providerType);

        // Normalize (e.g. add MARS for SQL Server)
        connectionString = bundle.Factory.NormalizeConnectionString(connectionString);

        // Detect server mode: no database specified → connect to system database
        var isServerMode = bundle.Factory.IsServerMode(connectionString);
        if (isServerMode)
            connectionString = bundle.Factory.SetDatabase(connectionString, bundle.Factory.DefaultSystemDatabase);

        var provider = await bundle.Factory.CreateAsync(connectionString, ct);

        var sessionId = Guid.NewGuid().ToString("N")[..12];
        _sessions[sessionId] = new SessionState(provider, bundle) { IsServerMode = isServerMode, ConnectionString = connectionString };

        _logger.LogInformation("Session {SessionId} created — server: {Server}, database: {Database}, mode: {Mode}, provider: {Provider}",
            sessionId, provider.ServerName, isServerMode ? "(server)" : provider.DatabaseName,
            isServerMode ? "server" : "single-db", providerType);

        return new ConnectResult(
            sessionId,
            isServerMode ? null : provider.DatabaseName,
            isServerMode,
            provider.ServerName);
    }

    public async Task<AnalysisResult> RunAnalysisAsync(
        string sessionId,
        List<string>? analyzers = null,
        string? signalRConnectionId = null,
        CancellationToken ct = default)
    {
        if (!_sessions.TryGetValue(sessionId, out var session))
            throw new InvalidOperationException($"Session '{sessionId}' not found. Connect first.");

        session.LastActivityUtc = DateTime.UtcNow;
        var analyzerNames = analyzers ?? ["schema", "profiling", "relationships", "quality", "usage"];

        _logger.LogInformation("Running analysis for session {SessionId}, analyzers: [{Analyzers}]",
            sessionId, string.Join(", ", analyzerNames));

        // Server mode: delegate to ServerAnalysisOrchestrator
        if (session.IsServerMode)
        {
            var orchestratorLogger = _serviceProvider.GetRequiredService<ILogger<ServerAnalysisOrchestrator>>();
            var orchestrator = new ServerAnalysisOrchestrator(
                _serviceProvider.GetServices<IAnalyzer>(), session.Bundle, orchestratorLogger);

            var result = await orchestrator.RunAsync(
                session.ConnectionString,
                analyzerNames,
                async (step, current, total, status) =>
                    await SendProgress(signalRConnectionId, step, current, total, status),
                ct);

            session.LastResult = result;
            return result;
        }

        var enabledNames = analyzerNames.Select(a => a.ToLowerInvariant()).ToHashSet();
        var analyzerInstances = _serviceProvider.GetServices<IAnalyzer>().ToList();

        var context = new AnalysisContext
        {
            Provider = session.Provider,
            CatalogQueries = session.Bundle.CatalogQueries,
            PerformanceQueries = session.Bundle.PerformanceQueries,
            ServerQueries = session.Bundle.ServerQueries,
            ProviderType = session.Bundle.ProviderType
        };

        var singleResult = new AnalysisResult
        {
            DatabaseName = session.Provider.DatabaseName,
            AnalyzedAt = DateTime.UtcNow
        };

        var total2 = analyzerInstances.Count(a => enabledNames.Contains(a.Name.ToLowerInvariant()));
        var current2 = 0;

        foreach (var analyzer in analyzerInstances)
        {
            if (!enabledNames.Contains(analyzer.Name.ToLowerInvariant()))
                continue;

            current2++;
            await SendProgress(signalRConnectionId, analyzer.Name, current2, total2, "running");

            await analyzer.AnalyzeAsync(context, singleResult, ct);

            await SendProgress(signalRConnectionId, analyzer.Name, current2, total2, "completed");
        }

        _logger.LogInformation("Analysis completed for session {SessionId}", sessionId);
        session.LastResult = singleResult;
        return singleResult;
    }

    // Dependency graph: analyzer → what it requires to have run first
    private static readonly Dictionary<string, string[]> AnalyzerDependencies = new()
    {
        ["schema"] = [],
        ["profiling"] = ["schema"],
        ["relationships"] = ["schema"],
        ["quality"] = ["schema", "relationships"],
        ["usage"] = ["schema", "profiling", "relationships"],
        ["indexing"] = ["schema"],
    };

    // Which result sections each analyzer populates
    private static bool HasAnalyzerRun(string analyzer, AnalysisResult result) => analyzer switch
    {
        "schema" => result.Schema is not null,
        "profiling" => result.Profiles is not null,
        "relationships" => result.Relationships is not null,
        "quality" => result.QualityIssues is not null,
        "usage" => result.UsageAnalysis is not null,
        "indexing" => result.IndexRecommendations is not null,
        _ => false
    };

    // Which downstream analyzers depend on a given analyzer
    private static readonly Dictionary<string, string[]> AnalyzerDependents = new()
    {
        ["schema"] = ["profiling", "relationships", "quality", "usage", "indexing"],
        ["profiling"] = ["usage"],
        ["relationships"] = ["quality", "usage"],
        ["quality"] = [],
        ["usage"] = [],
        ["indexing"] = [],
    };

    private static void ClearAnalyzerResult(string analyzer, AnalysisResult result)
    {
        switch (analyzer)
        {
            case "schema": result.Schema = null; break;
            case "profiling": result.Profiles = null; break;
            case "relationships": result.Relationships = null; break;
            case "quality": result.QualityIssues = null; break;
            case "usage": result.UsageAnalysis = null; break;
            case "indexing": result.IndexRecommendations = null; result.IndexInventory = null; break;
        }
    }

    public async Task<AnalysisResult> RunSingleAnalyzerAsync(
        string sessionId,
        string analyzerName,
        bool force = false,
        string? signalRConnectionId = null,
        string? database = null,
        CancellationToken ct = default)
    {
        if (!_sessions.TryGetValue(sessionId, out var session))
            throw new InvalidOperationException($"Session '{sessionId}' not found. Connect first.");

        session.LastActivityUtc = DateTime.UtcNow;
        analyzerName = analyzerName.ToLowerInvariant();
        if (!AnalyzerDependencies.ContainsKey(analyzerName))
            throw new ArgumentException($"Unknown analyzer: '{analyzerName}'");

        await session.Lock.WaitAsync(ct);
        try
        {
            // Server mode
            if (session.IsServerMode)
            {
                // Single-database targeting: connect to just that DB and run the analyzer
                if (!string.IsNullOrWhiteSpace(database))
                {
                    var dbConnStr = session.Bundle.Factory.SetDatabase(session.ConnectionString, database);
                    dbConnStr = session.Bundle.Factory.NormalizeConnectionString(dbConnStr);

                    await using var dbProvider = await session.Bundle.Factory.CreateAsync(dbConnStr, ct);

                    var context = new AnalysisContext
                    {
                        Provider = dbProvider,
                        CatalogQueries = session.Bundle.CatalogQueries,
                        PerformanceQueries = session.Bundle.PerformanceQueries,
                        ServerQueries = session.Bundle.ServerQueries,
                        ProviderType = session.Bundle.ProviderType
                    };

                    // Build a fresh result for this single DB
                    var dbResult = new AnalysisResult
                    {
                        DatabaseName = database,
                        AnalyzedAt = DateTime.UtcNow
                    };

                    // Resolve dependencies and run
                    var toRunDb = new List<string>();
                    ResolveAllDependencies(analyzerName, toRunDb);

                    var dbAnalyzers = _serviceProvider.GetServices<IAnalyzer>().ToList();
                    for (var i = 0; i < toRunDb.Count; i++)
                    {
                        var name = toRunDb[i];
                        var instance = dbAnalyzers.FirstOrDefault(a =>
                            a.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
                        if (instance is null) continue;

                        await SendProgress(signalRConnectionId, $"{name} ({database})", i + 1, toRunDb.Count, "running");
                        await instance.AnalyzeAsync(context, dbResult, ct);
                        await SendProgress(signalRConnectionId, $"{name} ({database})", i + 1, toRunDb.Count, "completed");
                    }

                    // Stamp DatabaseName on index recommendations and inventory
                    if (dbResult.IndexRecommendations is not null)
                    {
                        for (var idx = 0; idx < dbResult.IndexRecommendations.Count; idx++)
                            dbResult.IndexRecommendations[idx] = dbResult.IndexRecommendations[idx] with { DatabaseName = database };
                    }
                    if (dbResult.IndexInventory is not null)
                    {
                        for (var idx = 0; idx < dbResult.IndexInventory.Count; idx++)
                            dbResult.IndexInventory[idx] = dbResult.IndexInventory[idx] with { DatabaseName = database };
                    }

                    // Stamp DatabaseName on usage objects
                    if (dbResult.UsageAnalysis is not null)
                    {
                        foreach (var obj in dbResult.UsageAnalysis.Objects)
                            obj.DatabaseName = database;
                    }

                    // Stamp DatabaseName on profiles
                    if (dbResult.Profiles is not null)
                    {
                        foreach (var p in dbResult.Profiles)
                            p.DatabaseName = database;
                    }

                    // Merge into session result (preserve existing data from other analyzers/databases)
                    session.LastResult ??= new AnalysisResult
                    {
                        DatabaseName = session.ConnectionString,
                        AnalyzedAt = DateTime.UtcNow,
                        IsServerMode = true,
                        Databases = [],
                        Schema = new DatabaseSchema { DatabaseName = dbProvider.ServerName },
                    };

                    MergeSingleDbResult(session.LastResult, dbResult, analyzerName, database);
                    return session.LastResult;
                }

                // Full server-mode: delegate to ServerAnalysisOrchestrator (all databases)
                if (force || session.LastResult is null || !HasAnalyzerRun(analyzerName, session.LastResult))
                {
                    var orchLogger = _serviceProvider.GetRequiredService<ILogger<ServerAnalysisOrchestrator>>();
                    var orchestrator = new ServerAnalysisOrchestrator(
                        _serviceProvider.GetServices<IAnalyzer>(), session.Bundle, orchLogger);

                    // Resolve which analyzers to run (requested + dependencies)
                    var toRun = new List<string>();
                    ResolveAllDependencies(analyzerName, toRun);

                    var orchestratorResult = await orchestrator.RunAsync(
                        session.ConnectionString,
                        toRun,
                        async (step, current, total, status) =>
                            await SendProgress(signalRConnectionId, step, current, total, status),
                        ct);

                    // Merge into existing result instead of replacing
                    if (session.LastResult is null)
                    {
                        session.LastResult = orchestratorResult;
                    }
                    else
                    {
                        MergeServerResult(session.LastResult, orchestratorResult);
                    }
                }
                return session.LastResult;
            }

            var result = session.LastResult ??= new AnalysisResult
            {
                DatabaseName = session.Provider.DatabaseName,
                AnalyzedAt = DateTime.UtcNow
            };

            // If forcing, clear this analyzer's data and all downstream dependents
            if (force)
            {
                ClearAnalyzerResult(analyzerName, result);
                foreach (var dep in AnalyzerDependents[analyzerName])
                    ClearAnalyzerResult(dep, result);
            }

            // Resolve full list: dependencies first, then the requested analyzer
            var toRunSingle = new List<string>();
            ResolveDependencies(analyzerName, result, toRunSingle);

            if (toRunSingle.Count == 0)
                return result; // Already loaded, nothing to do

            var analysisContext = new AnalysisContext
            {
                Provider = session.Provider,
                CatalogQueries = session.Bundle.CatalogQueries,
                PerformanceQueries = session.Bundle.PerformanceQueries,
                ServerQueries = session.Bundle.ServerQueries,
                ProviderType = session.Bundle.ProviderType
            };

            var analyzerInstances = _serviceProvider.GetServices<IAnalyzer>().ToList();
            var total2 = toRunSingle.Count;

            for (var i = 0; i < toRunSingle.Count; i++)
            {
                var name = toRunSingle[i];
                var instance = analyzerInstances.FirstOrDefault(a =>
                    a.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

                if (instance is null) continue;

                await SendProgress(signalRConnectionId, name, i + 1, total2, "running");
                await instance.AnalyzeAsync(analysisContext, result, ct);
                await SendProgress(signalRConnectionId, name, i + 1, total2, "completed");
            }

            return result;
        }
        finally
        {
            session.Lock.Release();
        }
    }

    /// <summary>Resolve analyzer + all its dependencies (no result check — for server mode full re-run).</summary>
    private static void ResolveAllDependencies(string analyzer, List<string> toRun)
    {
        foreach (var dep in AnalyzerDependencies[analyzer])
        {
            if (!toRun.Contains(dep))
                ResolveAllDependencies(dep, toRun);
        }
        if (!toRun.Contains(analyzer))
            toRun.Add(analyzer);
    }

    private static void ResolveDependencies(string analyzer, AnalysisResult result, List<string> toRun)
    {
        // Recursively resolve dependencies first
        foreach (var dep in AnalyzerDependencies[analyzer])
        {
            if (!HasAnalyzerRun(dep, result) && !toRun.Contains(dep))
                ResolveDependencies(dep, result, toRun);
        }

        // Then add this analyzer if not already loaded
        if (!HasAnalyzerRun(analyzer, result) && !toRun.Contains(analyzer))
            toRun.Add(analyzer);
    }

    public AnalysisResult? GetResult(string sessionId)
    {
        if (!_sessions.TryGetValue(sessionId, out var session)) return null;
        session.LastActivityUtc = DateTime.UtcNow;
        return session.LastResult;
    }

    public async Task DisconnectAsync(string sessionId)
    {
        if (_sessions.TryRemove(sessionId, out var session))
        {
            await session.Provider.DisposeAsync();
            _logger.LogInformation("Session {SessionId} disconnected", sessionId);
        }
    }

    private async Task SendProgress(string? connectionId, string step, int current, int total, string status)
    {
        if (connectionId is null) return;

        await _hubContext.Clients.Client(connectionId).SendAsync("analysisProgress", new
        {
            step,
            current,
            total,
            status,
            percentage = total > 0 ? (int)(current * 100.0 / total) : 0
        });
    }

    /// <summary>Merge an orchestrator result into the existing session result (server mode).</summary>
    private static void MergeServerResult(AnalysisResult existing, AnalysisResult incoming)
    {
        existing.AnalyzedAt = incoming.AnalyzedAt;
        if (incoming.Schema is not null) existing.Schema = incoming.Schema;
        if (incoming.Profiles is not null) existing.Profiles = incoming.Profiles;
        if (incoming.Relationships is not null) existing.Relationships = incoming.Relationships;
        if (incoming.QualityIssues is not null) existing.QualityIssues = incoming.QualityIssues;
        if (incoming.UsageAnalysis is not null) existing.UsageAnalysis = incoming.UsageAnalysis;
        if (incoming.IndexRecommendations is not null) existing.IndexRecommendations = incoming.IndexRecommendations;
        if (incoming.IndexInventory is not null) existing.IndexInventory = incoming.IndexInventory;
        if (incoming.Databases?.Count > 0) existing.Databases = incoming.Databases;
        if (incoming.FailedDatabases?.Count > 0) existing.FailedDatabases = incoming.FailedDatabases;
    }

    /// <summary>Merge results from a single-DB analysis into the session's aggregate result.</summary>
    private static void MergeSingleDbResult(AnalysisResult merged, AnalysisResult dbResult, string analyzerName, string database)
    {
        // For the targeted analyzer, replace data for this database (remove old, add new)
        switch (analyzerName)
        {
            case "usage":
                merged.UsageAnalysis ??= new UsageAnalysis();
                merged.UsageAnalysis.Objects.RemoveAll(o =>
                    string.Equals(o.DatabaseName, database, StringComparison.OrdinalIgnoreCase));
                if (dbResult.UsageAnalysis is not null)
                {
                    merged.UsageAnalysis.Objects.AddRange(dbResult.UsageAnalysis.Objects);
                    merged.UsageAnalysis.ServerStartTime ??= dbResult.UsageAnalysis.ServerStartTime;
                    merged.UsageAnalysis.ServerUptimeDays ??= dbResult.UsageAnalysis.ServerUptimeDays;
                }
                break;

            case "profiling":
                merged.Profiles ??= [];
                merged.Profiles.RemoveAll(p =>
                    string.Equals(p.DatabaseName, database, StringComparison.OrdinalIgnoreCase));
                if (dbResult.Profiles is not null)
                    merged.Profiles.AddRange(dbResult.Profiles);
                break;

            case "indexing":
                merged.IndexRecommendations ??= [];
                merged.IndexRecommendations.RemoveAll(r =>
                    string.Equals(r.DatabaseName, database, StringComparison.OrdinalIgnoreCase));
                if (dbResult.IndexRecommendations is not null)
                    merged.IndexRecommendations.AddRange(dbResult.IndexRecommendations);

                merged.IndexInventory ??= [];
                merged.IndexInventory.RemoveAll(r =>
                    string.Equals(r.DatabaseName, database, StringComparison.OrdinalIgnoreCase));
                if (dbResult.IndexInventory is not null)
                    merged.IndexInventory.AddRange(dbResult.IndexInventory);
                break;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _cleanupTimer.DisposeAsync();
        foreach (var session in _sessions.Values)
        {
            await session.Provider.DisposeAsync();
        }
        _sessions.Clear();
    }

    private class SessionState(IDbProvider provider, IProviderBundle bundle)
    {
        public IDbProvider Provider { get; } = provider;
        public IProviderBundle Bundle { get; } = bundle;
        public AnalysisResult? LastResult { get; set; }
        public SemaphoreSlim Lock { get; } = new(1, 1);
        public bool IsServerMode { get; init; }
        public string ConnectionString { get; init; } = string.Empty;
        public DateTime LastActivityUtc { get; set; } = DateTime.UtcNow;
    }
}

public record ConnectResult(
    string SessionId,
    string? DatabaseName,
    bool IsServerMode = false,
    string? ServerName = null);

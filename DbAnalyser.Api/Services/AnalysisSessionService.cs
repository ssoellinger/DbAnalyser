using System.Collections.Concurrent;
using DbAnalyser.Analyzers;
using DbAnalyser.Api.Hubs;
using DbAnalyser.Configuration;
using DbAnalyser.Models.Schema;
using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;
using DbAnalyser.Providers.SqlServer;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace DbAnalyser.Api.Services;

public class AnalysisSessionService : IAsyncDisposable
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IHubContext<AnalysisHub> _hubContext;
    private readonly ILogger<AnalysisSessionService> _logger;
    private readonly ConcurrentDictionary<string, SessionState> _sessions = new();

    public AnalysisSessionService(IServiceProvider serviceProvider, IHubContext<AnalysisHub> hubContext, ILogger<AnalysisSessionService> logger)
    {
        _serviceProvider = serviceProvider;
        _hubContext = hubContext;
        _logger = logger;
    }

    public async Task<ConnectResult> ConnectAsync(string connectionString, CancellationToken ct = default)
    {
        // Ensure MARS is enabled (required for parallel analyzer queries)
        var builder = new SqlConnectionStringBuilder(connectionString)
        {
            MultipleActiveResultSets = true
        };

        // Detect server mode: no database specified → connect to master
        var isServerMode = string.IsNullOrWhiteSpace(builder.InitialCatalog);
        if (isServerMode)
            builder.InitialCatalog = "master";

        connectionString = builder.ConnectionString;

        var provider = new SqlServerProvider();
        await provider.ConnectAsync(connectionString, ct);

        var sessionId = Guid.NewGuid().ToString("N")[..12];
        _sessions[sessionId] = new SessionState(provider) { IsServerMode = isServerMode, ConnectionString = connectionString };

        _logger.LogInformation("Session {SessionId} created — server: {Server}, database: {Database}, mode: {Mode}",
            sessionId, provider.ServerName, isServerMode ? "(server)" : provider.DatabaseName,
            isServerMode ? "server" : "single-db");

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

        var analyzerNames = analyzers ?? ["schema", "profiling", "relationships", "quality", "usage"];

        _logger.LogInformation("Running analysis for session {SessionId}, analyzers: [{Analyzers}]",
            sessionId, string.Join(", ", analyzerNames));

        // Server mode: delegate to ServerAnalysisOrchestrator
        if (session.IsServerMode)
        {
            var orchestratorLogger = _serviceProvider.GetRequiredService<ILogger<ServerAnalysisOrchestrator>>();
            var orchestrator = new ServerAnalysisOrchestrator(
                _serviceProvider.GetServices<IAnalyzer>(), orchestratorLogger);

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

            await analyzer.AnalyzeAsync(session.Provider, singleResult, ct);

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
    };

    // Which result sections each analyzer populates
    private static bool HasAnalyzerRun(string analyzer, AnalysisResult result) => analyzer switch
    {
        "schema" => result.Schema is not null,
        "profiling" => result.Profiles is not null,
        "relationships" => result.Relationships is not null,
        "quality" => result.QualityIssues is not null,
        "usage" => result.UsageAnalysis is not null,
        _ => false
    };

    // Which downstream analyzers depend on a given analyzer
    private static readonly Dictionary<string, string[]> AnalyzerDependents = new()
    {
        ["schema"] = ["profiling", "relationships", "quality", "usage"],
        ["profiling"] = ["usage"],
        ["relationships"] = ["quality", "usage"],
        ["quality"] = [],
        ["usage"] = [],
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
                    var dbBuilder = new SqlConnectionStringBuilder(session.ConnectionString)
                    {
                        InitialCatalog = database,
                        MultipleActiveResultSets = true
                    };

                    await using var dbProvider = new SqlServerProvider();
                    await dbProvider.ConnectAsync(dbBuilder.ConnectionString, ct);

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
                        await instance.AnalyzeAsync(dbProvider, dbResult, ct);
                        await SendProgress(signalRConnectionId, $"{name} ({database})", i + 1, toRunDb.Count, "completed");
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
                        _serviceProvider.GetServices<IAnalyzer>(), orchLogger);

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

            var analyzerInstances = _serviceProvider.GetServices<IAnalyzer>().ToList();
            var total2 = toRunSingle.Count;

            for (var i = 0; i < toRunSingle.Count; i++)
            {
                var name = toRunSingle[i];
                var instance = analyzerInstances.FirstOrDefault(a =>
                    a.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

                if (instance is null) continue;

                await SendProgress(signalRConnectionId, name, i + 1, total2, "running");
                await instance.AnalyzeAsync(session.Provider, result, ct);
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
        return _sessions.TryGetValue(sessionId, out var session) ? session.LastResult : null;
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
        }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var session in _sessions.Values)
        {
            await session.Provider.DisposeAsync();
        }
        _sessions.Clear();
    }

    private class SessionState(IDbProvider provider)
    {
        public IDbProvider Provider { get; } = provider;
        public AnalysisResult? LastResult { get; set; }
        public SemaphoreSlim Lock { get; } = new(1, 1);
        public bool IsServerMode { get; init; }
        public string ConnectionString { get; init; } = string.Empty;
    }
}

public record ConnectResult(
    string SessionId,
    string? DatabaseName,
    bool IsServerMode = false,
    string? ServerName = null);

using System.Collections.Concurrent;
using DbAnalyser.Analyzers;
using DbAnalyser.Api.Hubs;
using DbAnalyser.Configuration;
using DbAnalyser.Providers;
using DbAnalyser.Providers.SqlServer;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;

namespace DbAnalyser.Api.Services;

public class AnalysisSessionService : IAsyncDisposable
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IHubContext<AnalysisHub> _hubContext;
    private readonly ConcurrentDictionary<string, SessionState> _sessions = new();

    public AnalysisSessionService(IServiceProvider serviceProvider, IHubContext<AnalysisHub> hubContext)
    {
        _serviceProvider = serviceProvider;
        _hubContext = hubContext;
    }

    public async Task<ConnectResult> ConnectAsync(string connectionString, CancellationToken ct = default)
    {
        // Ensure MARS is enabled (required for parallel analyzer queries)
        var builder = new SqlConnectionStringBuilder(connectionString)
        {
            MultipleActiveResultSets = true
        };
        connectionString = builder.ConnectionString;

        var provider = new SqlServerProvider();
        await provider.ConnectAsync(connectionString, ct);

        var sessionId = Guid.NewGuid().ToString("N")[..12];
        _sessions[sessionId] = new SessionState(provider);

        return new ConnectResult(sessionId, provider.DatabaseName);
    }

    public async Task<AnalysisResult> RunAnalysisAsync(
        string sessionId,
        List<string>? analyzers = null,
        string? signalRConnectionId = null,
        CancellationToken ct = default)
    {
        if (!_sessions.TryGetValue(sessionId, out var session))
            throw new InvalidOperationException($"Session '{sessionId}' not found. Connect first.");

        var options = new AnalysisOptions
        {
            Analyzers = analyzers ?? ["schema", "profiling", "relationships", "quality", "usage"]
        };

        var analyzerInstances = _serviceProvider.GetServices<IAnalyzer>().ToList();
        var enabledNames = options.Analyzers.Select(a => a.ToLowerInvariant()).ToHashSet();

        var result = new AnalysisResult
        {
            DatabaseName = session.Provider.DatabaseName,
            AnalyzedAt = DateTime.UtcNow
        };

        var total = analyzerInstances.Count(a => enabledNames.Contains(a.Name.ToLowerInvariant()));
        var current = 0;

        foreach (var analyzer in analyzerInstances)
        {
            if (!enabledNames.Contains(analyzer.Name.ToLowerInvariant()))
                continue;

            current++;
            await SendProgress(signalRConnectionId, analyzer.Name, current, total, "running");

            await analyzer.AnalyzeAsync(session.Provider, result, ct);

            await SendProgress(signalRConnectionId, analyzer.Name, current, total, "completed");
        }

        session.LastResult = result;
        return result;
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
            var toRun = new List<string>();
            ResolveDependencies(analyzerName, result, toRun);

            if (toRun.Count == 0)
                return result; // Already loaded, nothing to do

            var analyzerInstances = _serviceProvider.GetServices<IAnalyzer>().ToList();
            var total = toRun.Count;

            for (var i = 0; i < toRun.Count; i++)
            {
                var name = toRun[i];
                var instance = analyzerInstances.FirstOrDefault(a =>
                    a.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

                if (instance is null) continue;

                await SendProgress(signalRConnectionId, name, i + 1, total, "running");
                await instance.AnalyzeAsync(session.Provider, result, ct);
                await SendProgress(signalRConnectionId, name, i + 1, total, "completed");
            }

            return result;
        }
        finally
        {
            session.Lock.Release();
        }
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
    }
}

public record ConnectResult(string SessionId, string DatabaseName);

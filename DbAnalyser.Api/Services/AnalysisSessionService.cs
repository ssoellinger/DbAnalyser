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
            Analyzers = analyzers ?? ["schema", "profiling", "relationships", "quality"]
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
    }
}

public record ConnectResult(string SessionId, string DatabaseName);

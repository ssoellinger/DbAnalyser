using System.Diagnostics;
using DbAnalyser.Api.Services;
using DbAnalyser.Providers;

namespace DbAnalyser.Api.Endpoints;

public static class AnalysisEndpoints
{
    public static void MapAnalysisEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api");

        group.MapPost("/connect", async (ConnectRequest request, AnalysisSessionService sessionService, ILogger<AnalysisSessionService> logger, CancellationToken ct) =>
        {
            try
            {
                var result = await sessionService.ConnectAsync(request.ConnectionString, request.ProviderType ?? "sqlserver", ct);
                logger.LogInformation("Connected session {SessionId} to server {Server} (server mode: {IsServerMode})",
                    result.SessionId, result.ServerName, result.IsServerMode);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to connect");
                return Results.BadRequest(new { error = "Connection failed. Check your connection string and credentials." });
            }
        }).RequireRateLimiting("connect");

        group.MapPost("/analysis/start", async (StartAnalysisRequest request, AnalysisSessionService sessionService, ILogger<AnalysisSessionService> logger, CancellationToken ct) =>
        {
            try
            {
                logger.LogInformation("Starting analysis for session {SessionId}, analyzers: {Analyzers}",
                    request.SessionId, request.Analyzers ?? ["all"]);
                var result = await sessionService.RunAnalysisAsync(
                    request.SessionId,
                    request.Analyzers,
                    request.SignalRConnectionId,
                    ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Analysis failed for session {SessionId}", request.SessionId);
                return Results.BadRequest(new { error = "Analysis failed. Please try again." });
            }
        });

        group.MapPost("/analysis/run/{sessionId}/{analyzer}", async (string sessionId, string analyzer, RunAnalyzerRequest? request, AnalysisSessionService sessionService, ILogger<AnalysisSessionService> logger, CancellationToken ct) =>
        {
            try
            {
                logger.LogInformation("Running analyzer {Analyzer} for session {SessionId} (database: {Database})",
                    analyzer, sessionId, request?.Database ?? "n/a");
                var result = await sessionService.RunSingleAnalyzerAsync(
                    sessionId,
                    analyzer,
                    request?.Force ?? false,
                    request?.SignalRConnectionId,
                    request?.Database,
                    ct);
                return Results.Ok(result);
            }
            catch (ArgumentException ex)
            {
                logger.LogWarning(ex, "Bad request for analyzer {Analyzer}, session {SessionId}", analyzer, sessionId);
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Analyzer {Analyzer} failed for session {SessionId}", analyzer, sessionId);
                return Results.BadRequest(new { error = "Analysis failed. Please try again." });
            }
        });

        group.MapGet("/analysis/{sessionId}", (string sessionId, AnalysisSessionService sessionService) =>
        {
            var result = sessionService.GetResult(sessionId);
            return result is not null ? Results.Ok(result) : Results.NotFound(new { error = "No analysis result found" });
        });

        group.MapPost("/disconnect", async (DisconnectRequest request, AnalysisSessionService sessionService, ILogger<AnalysisSessionService> logger) =>
        {
            logger.LogInformation("Disconnecting session {SessionId}", request.SessionId);
            await sessionService.DisconnectAsync(request.SessionId);
            return Results.Ok(new { message = "Disconnected" });
        });

        group.MapGet("/providers", (ProviderRegistry registry) =>
        {
            return Results.Ok(new { providers = registry.AvailableProviders });
        });

        group.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

        group.MapGet("/query/{sessionId}/databases", async (string sessionId, AnalysisSessionService sessionService, CancellationToken ct) =>
        {
            var (_, databases, currentDatabase) = await sessionService.GetSessionInfoAsync(sessionId, ct);
            return Results.Ok(new { databases, currentDatabase });
        });

        // ── Transaction endpoints ──

        group.MapPost("/query/{sessionId}/transaction/begin", async (string sessionId, TransactionRequest? request, AnalysisSessionService sessionService, ILogger<AnalysisSessionService> logger, CancellationToken ct) =>
        {
            try
            {
                var txnId = await sessionService.BeginTransactionAsync(sessionId, request?.Database, ct);
                logger.LogInformation("Transaction {TxnId} started for session {SessionId}", txnId, sessionId);
                return Results.Ok(new { transactionId = txnId });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/query/{sessionId}/transaction/commit", async (string sessionId, AnalysisSessionService sessionService, ILogger<AnalysisSessionService> logger, CancellationToken ct) =>
        {
            try
            {
                await sessionService.CommitTransactionAsync(sessionId, ct);
                logger.LogInformation("Transaction committed for session {SessionId}", sessionId);
                return Results.Ok(new { message = "Transaction committed." });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/query/{sessionId}/transaction/rollback", async (string sessionId, AnalysisSessionService sessionService, ILogger<AnalysisSessionService> logger, CancellationToken ct) =>
        {
            try
            {
                await sessionService.RollbackTransactionAsync(sessionId, ct);
                logger.LogInformation("Transaction rolled back for session {SessionId}", sessionId);
                return Results.Ok(new { message = "Transaction rolled back." });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/query/{sessionId}", async (string sessionId, ExecuteQueryRequest request, AnalysisSessionService sessionService, ILogger<AnalysisSessionService> logger, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Sql))
                return Results.BadRequest(new { error = "SQL query is required." });

            if (sessionService.IsFileSession(sessionId))
                return Results.BadRequest(new { error = "Cannot execute queries in file-session mode." });

            var provider = sessionService.GetProvider(sessionId);
            if (provider is null)
                return Results.NotFound(new { error = "Session not found. Connect first." });

            var maxRows = request.MaxRows ?? 1000;
            var timeoutSeconds = request.TimeoutSeconds ?? 30;
            var connStr = sessionService.GetConnectionString(sessionId, request.Database) ?? provider.ConnectionString;
            var activeTxnId = sessionService.GetActiveTransactionId(sessionId);
            var sw = Stopwatch.StartNew();

            try
            {
                var execResult = activeTxnId is not null
                    ? await provider.ExecuteInTransactionAsync(activeTxnId, request.Sql, maxRows, timeoutSeconds, ct)
                    : await provider.ExecuteQueryFullAsync(request.Sql, connStr, maxRows, timeoutSeconds, request.ShowPlan, request.ShowStats, ct);
                sw.Stop();

                var resultSets = new List<QueryResultSetDto>();
                foreach (var table in execResult.ResultSets)
                {
                    var columns = new List<string>();
                    for (var i = 0; i < table.Columns.Count; i++)
                        columns.Add(table.Columns[i].ColumnName);

                    var rows = new List<List<object?>>();
                    foreach (System.Data.DataRow row in table.Rows)
                    {
                        var rowData = new List<object?>();
                        foreach (var val in row.ItemArray)
                        {
                            rowData.Add(val switch
                            {
                                null or DBNull => null,
                                byte[] => "(binary)",
                                DateTime dt => dt.ToString("O"),
                                DateTimeOffset dto => dto.ToString("O"),
                                _ => val
                            });
                        }
                        rows.Add(rowData);
                    }

                    resultSets.Add(new QueryResultSetDto(
                        columns,
                        rows,
                        table.Rows.Count,
                        table.Rows.Count >= maxRows));
                }

                logger.LogInformation("Query executed for session {SessionId}: {ResultSets} result set(s), {ElapsedMs}ms",
                    sessionId, resultSets.Count, sw.ElapsedMilliseconds);

                return Results.Ok(new QueryResponseDto(resultSets, sw.ElapsedMilliseconds, null, execResult.Messages, execResult.ExecutionPlan));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                sw.Stop();
                logger.LogWarning(ex, "Query failed for session {SessionId}", sessionId);
                return Results.Ok(new QueryResponseDto([], sw.ElapsedMilliseconds, ex.Message));
            }
        });
    }
}

public record ConnectRequest(string ConnectionString, string? ProviderType = "sqlserver");
public record StartAnalysisRequest(string SessionId, List<string>? Analyzers = null, string? SignalRConnectionId = null);
public record DisconnectRequest(string SessionId);
public record RunAnalyzerRequest(string? SignalRConnectionId = null, bool Force = false, string? Database = null);
public record ExecuteQueryRequest(string Sql, int? MaxRows = 1000, int? TimeoutSeconds = 30, string? Database = null, bool ShowPlan = false, bool ShowStats = false);
public record TransactionRequest(string? Database = null);
public record QueryResultSetDto(List<string> Columns, List<List<object?>> Rows, int TotalRowsReturned, bool Truncated);
public record QueryResponseDto(List<QueryResultSetDto> ResultSets, long ElapsedMs, string? Error, List<string>? Messages = null, string? ExecutionPlan = null);

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
                return Results.BadRequest(new { error = ex.Message });
            }
        });

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
                return Results.BadRequest(new { error = ex.Message });
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
                return Results.BadRequest(new { error = ex.Message });
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
    }
}

public record ConnectRequest(string ConnectionString, string? ProviderType = "sqlserver");
public record StartAnalysisRequest(string SessionId, List<string>? Analyzers = null, string? SignalRConnectionId = null);
public record DisconnectRequest(string SessionId);
public record RunAnalyzerRequest(string? SignalRConnectionId = null, bool Force = false, string? Database = null);

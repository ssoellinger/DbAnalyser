using DbAnalyser.Api.Services;

namespace DbAnalyser.Api.Endpoints;

public static class AnalysisEndpoints
{
    public static void MapAnalysisEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api");

        group.MapPost("/connect", async (ConnectRequest request, AnalysisSessionService sessionService, CancellationToken ct) =>
        {
            try
            {
                var result = await sessionService.ConnectAsync(request.ConnectionString, ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/analysis/start", async (StartAnalysisRequest request, AnalysisSessionService sessionService, CancellationToken ct) =>
        {
            try
            {
                var result = await sessionService.RunAnalysisAsync(
                    request.SessionId,
                    request.Analyzers,
                    request.SignalRConnectionId,
                    ct);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapGet("/analysis/{sessionId}", (string sessionId, AnalysisSessionService sessionService) =>
        {
            var result = sessionService.GetResult(sessionId);
            return result is not null ? Results.Ok(result) : Results.NotFound(new { error = "No analysis result found" });
        });

        group.MapPost("/disconnect", async (DisconnectRequest request, AnalysisSessionService sessionService) =>
        {
            await sessionService.DisconnectAsync(request.SessionId);
            return Results.Ok(new { message = "Disconnected" });
        });

        group.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
    }
}

public record ConnectRequest(string ConnectionString);
public record StartAnalysisRequest(string SessionId, List<string>? Analyzers = null, string? SignalRConnectionId = null);
public record DisconnectRequest(string SessionId);

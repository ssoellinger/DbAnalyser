using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using DbAnalyser.Analyzers;
using DbAnalyser.Api.Endpoints;
using DbAnalyser.Api.Hubs;
using DbAnalyser.Api.Services;
using DbAnalyser.Providers;
using DbAnalyser.Providers.PostgreSql;
using DbAnalyser.Providers.SqlServer;
using Microsoft.AspNetCore.RateLimiting;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // If DBANALYSER_LOG_DIR is set (e.g. by Electron), override the log file path
    var logDir = Environment.GetEnvironmentVariable("DBANALYSER_LOG_DIR");
    builder.Host.UseSerilog((context, services, configuration) =>
    {
        configuration.ReadFrom.Configuration(context.Configuration);
        if (!string.IsNullOrEmpty(logDir))
        {
            var logPath = Path.Combine(logDir, "api-.log");
            configuration.WriteTo.File(
                logPath,
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 14,
                fileSizeLimitBytes: 10_485_760,
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}");
        }
    });

    // JSON serialization matching JsonReportGenerator
    builder.Services.ConfigureHttpJsonOptions(options =>
    {
        options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    });

    // SignalR
    builder.Services.AddSignalR().AddJsonProtocol(options =>
    {
        options.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    });

    // CORS for Vite dev server
    builder.Services.AddCors(options =>
    {
        options.AddDefaultPolicy(policy =>
        {
            policy.WithOrigins("http://localhost:5173")
                  .WithHeaders("Content-Type", "Authorization")
                  .WithMethods("GET", "POST")
                  .AllowCredentials();
        });
    });

    // Rate limiting
    builder.Services.AddRateLimiter(options =>
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.AddFixedWindowLimiter("connect", opt =>
        {
            opt.PermitLimit = 30;
            opt.Window = TimeSpan.FromMinutes(1);
            opt.QueueLimit = 0;
        });
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            RateLimitPartition.GetFixedWindowLimiter("global", _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 100,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
    });

    // Provider bundles
    builder.Services.AddSingleton<IProviderBundle, SqlServerBundle>();
    builder.Services.AddSingleton<IProviderBundle, PostgreSqlBundle>();
    builder.Services.AddSingleton<ProviderRegistry>();

    // Analyzers
    builder.Services.AddSingleton<IAnalyzer, SchemaAnalyzer>();
    builder.Services.AddSingleton<IAnalyzer, DataProfileAnalyzer>();
    builder.Services.AddSingleton<IAnalyzer, RelationshipAnalyzer>();
    builder.Services.AddSingleton<IAnalyzer, QualityAnalyzer>();
    builder.Services.AddSingleton<IAnalyzer, UsageAnalyzer>();
    builder.Services.AddSingleton<IAnalyzer, IndexingAnalyzer>();

    // Session service
    builder.Services.AddSingleton<AnalysisSessionService>();

    var app = builder.Build();

    // Security headers
    app.Use(async (context, next) =>
    {
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["X-Frame-Options"] = "DENY";
        context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
        await next();
    });

    app.UseRateLimiter();
    app.UseCors();

    app.MapHub<AnalysisHub>("/hubs/analysis");
    app.MapAnalysisEndpoints();

    var port = args.FirstOrDefault(a => a.StartsWith("--port="))?.Split('=')[1] ?? "5000";
    Log.Information("Starting DbAnalyser API on port {Port}", port);
    app.Run($"http://localhost:{port}");
}
catch (Exception ex)
{
    Log.Fatal(ex, "Application terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();
}

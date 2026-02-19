using System.Text.Json;
using System.Text.Json.Serialization;
using DbAnalyser.Analyzers;
using DbAnalyser.Api.Endpoints;
using DbAnalyser.Api.Hubs;
using DbAnalyser.Api.Services;

var builder = WebApplication.CreateBuilder(args);

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
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// Analyzers
builder.Services.AddSingleton<IAnalyzer, SchemaAnalyzer>();
builder.Services.AddSingleton<IAnalyzer, DataProfileAnalyzer>();
builder.Services.AddSingleton<IAnalyzer, RelationshipAnalyzer>();
builder.Services.AddSingleton<IAnalyzer, QualityAnalyzer>();
builder.Services.AddSingleton<IAnalyzer, UsageAnalyzer>();

// Session service
builder.Services.AddSingleton<AnalysisSessionService>();

var app = builder.Build();

app.UseCors();

app.MapHub<AnalysisHub>("/hubs/analysis");
app.MapAnalysisEndpoints();

var port = args.FirstOrDefault(a => a.StartsWith("--port="))?.Split('=')[1] ?? "5000";
app.Run($"http://localhost:{port}");

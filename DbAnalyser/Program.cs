using System.CommandLine;
using DbAnalyser.Analyzers;
using DbAnalyser.Configuration;
using DbAnalyser.Providers;
using DbAnalyser.Providers.SqlServer;
using DbAnalyser.Reporting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Spectre.Console;

// SqlServer bundle for catalog/performance queries
var sqlServerBundle = new SqlServerBundle();

var connectionStringOption = new Option<string?>("--connection-string");
connectionStringOption.Aliases.Add("-cs");
connectionStringOption.Description = "SQL Server connection string";

var formatOption = new Option<OutputFormat>("--format");
formatOption.Aliases.Add("-f");
formatOption.Description = "Output format: Console, Html, or Json";
formatOption.DefaultValueFactory = _ => OutputFormat.Console;

var outputOption = new Option<string?>("--output");
outputOption.Aliases.Add("-o");
outputOption.Description = "Output file path (for Html/Json formats)";

var analyzersOption = new Option<string[]>("--analyzers");
analyzersOption.Aliases.Add("-a");
analyzersOption.Description = "Analyzers to run: schema, profiling, relationships, quality";
analyzersOption.DefaultValueFactory = _ => new[] { "schema", "profiling", "relationships", "quality" };

var rootCommand = new RootCommand("DbAnalyser - Database structure and quality analyzer")
{
    connectionStringOption,
    formatOption,
    outputOption,
    analyzersOption
};

rootCommand.SetAction(async (parseResult, ct) =>
{
    var connStr = parseResult.GetValue(connectionStringOption);
    var format = parseResult.GetValue(formatOption);
    var output = parseResult.GetValue(outputOption);
    var analyzers = parseResult.GetValue(analyzersOption) ?? [];

    // Load config from appsettings.json as fallback
    var config = new ConfigurationBuilder()
        .SetBasePath(AppContext.BaseDirectory)
        .AddJsonFile("appsettings.json", optional: true)
        .Build();

    var options = new AnalysisOptions
    {
        ConnectionString = connStr ?? config["ConnectionString"] ?? string.Empty,
        OutputPath = output ?? (string.IsNullOrEmpty(config["OutputPath"]) ? null : config["OutputPath"]),
        Analyzers = analyzers.Length > 0 ? analyzers.ToList() : ["schema", "profiling", "relationships", "quality"]
    };

    if (string.IsNullOrWhiteSpace(options.ConnectionString))
    {
        AnsiConsole.MarkupLine("[red]Error:[/] Connection string is required. Use --connection-string or set it in appsettings.json.");
        return;
    }

    // Set up DI
    var services = new ServiceCollection();
    services.AddSingleton(options);
    services.AddSingleton<IDbProvider, SqlServerProvider>();
    services.AddSingleton<IAnalyzer, SchemaAnalyzer>();
    services.AddSingleton<IAnalyzer, DataProfileAnalyzer>();
    services.AddSingleton<IAnalyzer, RelationshipAnalyzer>();
    services.AddSingleton<IAnalyzer, QualityAnalyzer>();
    services.AddSingleton<AnalyzerOrchestrator>();
    services.AddSingleton<IReportGenerator, ConsoleReportGenerator>();
    services.AddSingleton<IReportGenerator, JsonReportGenerator>();
    services.AddSingleton<IReportGenerator, HtmlReportGenerator>();

    var sp = services.BuildServiceProvider();

    var provider = sp.GetRequiredService<IDbProvider>();
    var orchestrator = sp.GetRequiredService<AnalyzerOrchestrator>();
    var reporters = sp.GetServices<IReportGenerator>();

    try
    {
        await AnsiConsole.Status()
            .SpinnerStyle(Style.Parse("green"))
            .StartAsync("Connecting to database...", async ctx =>
            {
                await provider.ConnectAsync(options.ConnectionString);
                AnsiConsole.MarkupLine($"[green]Connected to:[/] {Markup.Escape(provider.DatabaseName)}");

                ctx.Status("Running analysis...");
                var context = new AnalysisContext
                {
                    Provider = provider,
                    CatalogQueries = sqlServerBundle.CatalogQueries,
                    PerformanceQueries = sqlServerBundle.PerformanceQueries,
                    ServerQueries = sqlServerBundle.ServerQueries,
                    ProviderType = sqlServerBundle.ProviderType,
                };
                var result = await orchestrator.RunAsync(context, options);

                ctx.Status("Generating report...");
                var reporter = reporters.FirstOrDefault(r => r.Format == format)
                    ?? throw new InvalidOperationException($"No report generator found for format '{format}'");

                await reporter.GenerateAsync(result, options.OutputPath);
            });
    }
    catch (Exception ex)
    {
        AnsiConsole.MarkupLine($"[red]Error:[/] {Markup.Escape(ex.Message)}");
        Environment.ExitCode = 1;
    }
    finally
    {
        await provider.DisposeAsync();
    }
});

return await rootCommand.Parse(args).InvokeAsync();

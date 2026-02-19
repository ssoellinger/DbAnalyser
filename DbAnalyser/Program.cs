using System.CommandLine;
using DbAnalyser.Analyzers;
using DbAnalyser.Configuration;
using DbAnalyser.Providers;
using DbAnalyser.Providers.SqlServer;
using DbAnalyser.Reporting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Spectre.Console;

var connectionStringOption = new Option<string?>(
    aliases: ["--connection-string", "-cs"],
    description: "SQL Server connection string");

var formatOption = new Option<OutputFormat>(
    aliases: ["--format", "-f"],
    getDefaultValue: () => OutputFormat.Console,
    description: "Output format: Console, Html, or Json");

var outputOption = new Option<string?>(
    aliases: ["--output", "-o"],
    description: "Output file path (for Html/Json formats)");

var analyzersOption = new Option<string[]>(
    aliases: ["--analyzers", "-a"],
    getDefaultValue: () => ["schema", "profiling", "relationships", "quality"],
    description: "Analyzers to run: schema, profiling, relationships, quality");

var rootCommand = new RootCommand("DbAnalyser - Database structure and quality analyzer")
{
    connectionStringOption,
    formatOption,
    outputOption,
    analyzersOption
};

rootCommand.SetHandler(async (string? connStr, OutputFormat format, string? output, string[] analyzers) =>
{
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
                var result = await orchestrator.RunAsync(provider, options);

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

}, connectionStringOption, formatOption, outputOption, analyzersOption);

return await rootCommand.InvokeAsync(args);

using Microsoft.Extensions.Configuration;

namespace DbAnalyser.IntegrationTests;

/// <summary>
/// Shared fixture that loads the connection string from testsettings.json
/// or the DBANALYSER_CONNECTION_STRING environment variable.
/// </summary>
public class TestFixture
{
    public string? ConnectionString { get; }

    public TestFixture()
    {
        var config = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("testsettings.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        ConnectionString = config["DBANALYSER_CONNECTION_STRING"]
            ?? config["ConnectionString"];
    }

    public bool IsAvailable => !string.IsNullOrWhiteSpace(ConnectionString);
}

/// <summary>
/// Marks a test that requires a live SQL Server / Azure SQL connection.
/// Skipped automatically when no connection string is configured.
/// </summary>
public sealed class SqlServerFactAttribute : FactAttribute
{
    private static readonly TestFixture Fixture = new();

    public SqlServerFactAttribute()
    {
        if (!Fixture.IsAvailable)
            Skip = "No SQL Server connection string configured. Set ConnectionString in testsettings.json or DBANALYSER_CONNECTION_STRING env var.";
    }
}

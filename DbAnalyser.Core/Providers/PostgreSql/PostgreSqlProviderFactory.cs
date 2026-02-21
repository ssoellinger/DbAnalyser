using Npgsql;

namespace DbAnalyser.Providers.PostgreSql;

public class PostgreSqlProviderFactory : IDbProviderFactory
{
    public string ProviderType => "postgresql";
    public string DefaultSystemDatabase => "postgres";

    public async Task<IDbProvider> CreateAsync(string connectionString, CancellationToken ct)
    {
        var provider = new PostgreSqlProvider();
        await provider.ConnectAsync(connectionString, ct);
        return provider;
    }

    public string NormalizeConnectionString(string connectionString)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        return builder.ConnectionString;
    }

    public bool IsServerMode(string connectionString)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        return string.IsNullOrWhiteSpace(builder.Database);
    }

    public string SetDatabase(string connectionString, string databaseName)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString)
        {
            Database = databaseName
        };
        return builder.ConnectionString;
    }
}

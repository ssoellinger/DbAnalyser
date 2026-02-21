using Microsoft.Data.SqlClient;

namespace DbAnalyser.Providers.SqlServer;

public class SqlServerProviderFactory : IDbProviderFactory
{
    public string ProviderType => "sqlserver";
    public string DefaultSystemDatabase => "master";

    public async Task<IDbProvider> CreateAsync(string connectionString, CancellationToken ct)
    {
        var provider = new SqlServerProvider();
        await provider.ConnectAsync(connectionString, ct);
        return provider;
    }

    public string NormalizeConnectionString(string connectionString)
    {
        var builder = new SqlConnectionStringBuilder(connectionString)
        {
            MultipleActiveResultSets = true
        };
        return builder.ConnectionString;
    }

    public bool IsServerMode(string connectionString)
    {
        var builder = new SqlConnectionStringBuilder(connectionString);
        return string.IsNullOrWhiteSpace(builder.InitialCatalog);
    }

    public string SetDatabase(string connectionString, string databaseName)
    {
        var builder = new SqlConnectionStringBuilder(connectionString)
        {
            InitialCatalog = databaseName
        };
        return builder.ConnectionString;
    }
}

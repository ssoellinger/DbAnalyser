using Oracle.ManagedDataAccess.Client;

namespace DbAnalyser.Providers.Oracle;

public class OracleProviderFactory : IDbProviderFactory
{
    public string ProviderType => "oracle";
    public string DefaultSystemDatabase => "";

    public async Task<IDbProvider> CreateAsync(string connectionString, CancellationToken ct)
    {
        var provider = new OracleProvider();
        await provider.ConnectAsync(connectionString, ct);
        return provider;
    }

    public string NormalizeConnectionString(string connectionString)
    {
        var builder = new OracleConnectionStringBuilder(connectionString);
        return builder.ConnectionString;
    }

    public bool IsServerMode(string connectionString)
    {
        // Oracle doesn't have a "database" concept in the same way — always show all accessible schemas
        return true;
    }

    public string SetDatabase(string connectionString, string databaseName)
    {
        // Oracle doesn't switch databases — schemas are selected via query scope
        return connectionString;
    }
}

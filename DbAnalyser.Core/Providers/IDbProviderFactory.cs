namespace DbAnalyser.Providers;

/// <summary>Creates IDbProvider instances and handles connection string manipulation.</summary>
public interface IDbProviderFactory
{
    string ProviderType { get; }
    string DefaultSystemDatabase { get; }
    Task<IDbProvider> CreateAsync(string connectionString, CancellationToken ct);
    string NormalizeConnectionString(string connectionString);
    bool IsServerMode(string connectionString);
    string SetDatabase(string connectionString, string databaseName);
}

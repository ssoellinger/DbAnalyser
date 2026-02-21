using System.Data;

namespace DbAnalyser.Providers;

public interface IDbProvider : IAsyncDisposable
{
    string ConnectionString { get; }
    string DatabaseName { get; }
    string ServerName { get; }
    Task ConnectAsync(string connectionString, CancellationToken ct = default);
    Task ChangeDatabaseAsync(string databaseName, CancellationToken ct = default);
    Task<DataTable> ExecuteQueryAsync(string sql, CancellationToken ct = default);
    Task<object?> ExecuteScalarAsync(string sql, CancellationToken ct = default);
}

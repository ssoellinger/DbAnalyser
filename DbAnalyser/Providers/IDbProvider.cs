using System.Data;

namespace DbAnalyser.Providers;

public interface IDbProvider : IAsyncDisposable
{
    string DatabaseName { get; }
    Task ConnectAsync(string connectionString, CancellationToken ct = default);
    Task<DataTable> ExecuteQueryAsync(string sql, CancellationToken ct = default);
    Task<object?> ExecuteScalarAsync(string sql, CancellationToken ct = default);
}

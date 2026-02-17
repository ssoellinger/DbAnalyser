using System.Data;
using Microsoft.Data.SqlClient;

namespace DbAnalyser.Providers.SqlServer;

public class SqlServerProvider : IDbProvider
{
    private SqlConnection? _connection;

    public string DatabaseName => _connection?.Database ?? string.Empty;

    public async Task ConnectAsync(string connectionString, CancellationToken ct = default)
    {
        _connection = new SqlConnection(connectionString);
        await _connection.OpenAsync(ct);
    }

    public async Task<DataTable> ExecuteQueryAsync(string sql, CancellationToken ct = default)
    {
        if (_connection is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");

        await using var cmd = new SqlCommand(sql, _connection);
        cmd.CommandTimeout = 120;

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var table = new DataTable();
        table.Load(reader);
        return table;
    }

    public async Task<object?> ExecuteScalarAsync(string sql, CancellationToken ct = default)
    {
        if (_connection is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");

        await using var cmd = new SqlCommand(sql, _connection);
        cmd.CommandTimeout = 120;

        var result = await cmd.ExecuteScalarAsync(ct);
        return result == DBNull.Value ? null : result;
    }

    public async ValueTask DisposeAsync()
    {
        if (_connection is not null)
        {
            await _connection.DisposeAsync();
            _connection = null;
        }
    }
}

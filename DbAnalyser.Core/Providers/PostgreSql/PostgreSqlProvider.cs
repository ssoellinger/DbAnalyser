using System.Data;
using Npgsql;

namespace DbAnalyser.Providers.PostgreSql;

public class PostgreSqlProvider : IDbProvider
{
    private NpgsqlDataSource? _dataSource;
    private NpgsqlConnection? _connection;
    private string _connectionString = string.Empty;

    public string ConnectionString => _connectionString;
    public string DatabaseName => _connection?.Database ?? string.Empty;
    public string ServerName => _connection?.Host ?? string.Empty;

    public async Task ConnectAsync(string connectionString, CancellationToken ct = default)
    {
        _connectionString = connectionString;
        _dataSource = NpgsqlDataSource.Create(connectionString);

        // Keep one connection open for metadata (DatabaseName, ServerName)
        _connection = await _dataSource.OpenConnectionAsync(ct);
    }

    public async Task ChangeDatabaseAsync(string databaseName, CancellationToken ct = default)
    {
        if (_connection is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");
        await _connection.ChangeDatabaseAsync(databaseName, ct);
    }

    public async Task<DataTable> ExecuteQueryAsync(string sql, CancellationToken ct = default)
    {
        if (_dataSource is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");

        // Each query gets its own pooled connection — safe for parallel execution
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.CommandTimeout = 300;

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var table = new DataTable();
        table.Load(reader);
        return table;
    }

    public async Task<object?> ExecuteScalarAsync(string sql, CancellationToken ct = default)
    {
        if (_dataSource is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");

        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.CommandTimeout = 300;

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
        if (_dataSource is not null)
        {
            await _dataSource.DisposeAsync();
            _dataSource = null;
        }
    }
}

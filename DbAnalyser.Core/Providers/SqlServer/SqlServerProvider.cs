using System.Data;
using Microsoft.Data.SqlClient;

namespace DbAnalyser.Providers.SqlServer;

public class SqlServerProvider : IDbProvider
{
    private SqlConnection? _connection;
    private string _connectionString = string.Empty;

    public string ConnectionString => _connectionString;
    public string DatabaseName => _connection?.Database ?? string.Empty;
    public string ServerName => _connection?.DataSource ?? string.Empty;

    public async Task ConnectAsync(string connectionString, CancellationToken ct = default)
    {
        _connectionString = connectionString;
        _connection = new SqlConnection(connectionString);
        await _connection.OpenAsync(ct);
    }

    public async Task ChangeDatabaseAsync(string databaseName, CancellationToken ct = default)
    {
        if (_connection is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");
        await _connection.ChangeDatabaseAsync(databaseName, ct);
    }

    public async Task<DataTable> ExecuteQueryAsync(string sql, CancellationToken ct = default)
    {
        if (_connection is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");

        await using var cmd = new SqlCommand(sql, _connection);
        cmd.CommandTimeout = 300;

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
        cmd.CommandTimeout = 300;

        var result = await cmd.ExecuteScalarAsync(ct);
        return result == DBNull.Value ? null : result;
    }

    public Task<List<DataTable>> ExecuteQueryMultipleAsync(string sql, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
        => ExecuteQueryMultipleAsync(sql, _connectionString, maxRows, timeoutSeconds, ct);

    public async Task<List<DataTable>> ExecuteQueryMultipleAsync(string sql, string connectionStringOverride, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionStringOverride);
        await conn.OpenAsync(ct);

        await using var cmd = new SqlCommand(sql, conn);
        cmd.CommandTimeout = timeoutSeconds;

        var results = new List<DataTable>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        do
        {
            var table = new DataTable();
            for (var i = 0; i < reader.FieldCount; i++)
                table.Columns.Add(reader.GetName(i), reader.GetFieldType(i) ?? typeof(object));

            var rowCount = 0;
            while (rowCount < maxRows && await reader.ReadAsync(ct))
            {
                var values = new object[reader.FieldCount];
                reader.GetValues(values);
                table.Rows.Add(values);
                rowCount++;
            }

            results.Add(table);
        } while (await reader.NextResultAsync(ct));

        return results;
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

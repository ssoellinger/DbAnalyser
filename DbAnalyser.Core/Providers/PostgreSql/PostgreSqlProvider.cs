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

    public Task<List<DataTable>> ExecuteQueryMultipleAsync(string sql, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
        => ExecuteQueryMultipleAsync(sql, _connectionString, maxRows, timeoutSeconds, ct);

    public async Task<List<DataTable>> ExecuteQueryMultipleAsync(string sql, string connectionStringOverride, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
    {
        await using var ds = NpgsqlDataSource.Create(connectionStringOverride);
        await using var conn = await ds.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
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

    public async Task<QueryExecutionResult> ExecuteQueryFullAsync(string sql, string connectionString, int maxRows = 1000, int timeoutSeconds = 30, bool showPlan = false, CancellationToken ct = default)
    {
        var messages = new List<string>();

        // Plan-only mode: return only the plan
        if (showPlan)
        {
            await using var planDs = NpgsqlDataSource.Create(connectionString);
            await using var planConn = await planDs.OpenConnectionAsync(ct);
            await using var planCmd = new NpgsqlCommand($"EXPLAIN {sql}", planConn) { CommandTimeout = timeoutSeconds };
            await using var planReader = await planCmd.ExecuteReaderAsync(ct);

            var planLines = new List<string>();
            while (await planReader.ReadAsync(ct))
            {
                if (planReader.FieldCount > 0)
                    planLines.Add(planReader.GetString(0));
            }

            return new QueryExecutionResult([], messages, string.Join("\n", planLines));
        }

        // Normal execution
        await using var ds = NpgsqlDataSource.Create(connectionString);
        await using var conn = await ds.OpenConnectionAsync(ct);
        conn.Notice += (_, e) => {
            if (!string.IsNullOrWhiteSpace(e.Notice.MessageText))
                messages.Add(e.Notice.MessageText);
        };

        await using var cmd = new NpgsqlCommand(sql, conn) { CommandTimeout = timeoutSeconds };
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

        if (reader.RecordsAffected >= 0)
            messages.Add($"({reader.RecordsAffected} row(s) affected)");

        return new QueryExecutionResult(results, messages);
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

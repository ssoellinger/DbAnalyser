using System.Collections.Concurrent;
using System.Data;
using Microsoft.Data.SqlClient;

namespace DbAnalyser.Providers.SqlServer;

public class SqlServerProvider : IDbProvider
{
    private SqlConnection? _connection;
    private string _connectionString = string.Empty;
    private readonly ConcurrentDictionary<string, (SqlConnection Connection, SqlTransaction Transaction)> _transactions = new();

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

    public async Task<QueryExecutionResult> ExecuteQueryFullAsync(string sql, string connectionString, int maxRows = 1000, int timeoutSeconds = 30, bool showPlan = false, bool showStats = false, CancellationToken ct = default)
    {
        var messages = new List<string>();

        // Plan-only mode: separate connection, return only the plan
        if (showPlan)
        {
            await using var planConn = new SqlConnection(connectionString);
            await planConn.OpenAsync(ct);

            await using var planOnCmd = new SqlCommand("SET SHOWPLAN_TEXT ON", planConn);
            await planOnCmd.ExecuteNonQueryAsync(ct);

            await using var planCmd = new SqlCommand(sql, planConn) { CommandTimeout = timeoutSeconds };
            await using var planReader = await planCmd.ExecuteReaderAsync(ct);

            var planLines = new List<string>();
            do
            {
                while (await planReader.ReadAsync(ct))
                {
                    if (planReader.FieldCount > 0)
                        planLines.Add(planReader.GetString(0));
                }
            } while (await planReader.NextResultAsync(ct));

            return new QueryExecutionResult([], messages, string.Join("\n", planLines));
        }

        // Normal execution
        await using var conn = new SqlConnection(connectionString);
        conn.InfoMessage += (_, e) => {
            if (!string.IsNullOrWhiteSpace(e.Message))
                messages.Add(e.Message);
        };
        await conn.OpenAsync(ct);

        // Enable STATISTICS IO only when explicitly requested
        if (showStats)
        {
            await using var statsCmd = new SqlCommand("SET STATISTICS IO ON", conn);
            await statsCmd.ExecuteNonQueryAsync(ct);
        }

        var limitedSql = SqlRowLimiter.ApplyTopForSqlServer(sql, maxRows);
        await using var cmd = new SqlCommand(limitedSql, conn) { CommandTimeout = timeoutSeconds };
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

    public async Task<string> BeginTransactionAsync(string connectionString, CancellationToken ct = default)
    {
        var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);
        var txn = (SqlTransaction)await conn.BeginTransactionAsync(ct);
        var txnId = Guid.NewGuid().ToString("N")[..12];
        _transactions[txnId] = (conn, txn);
        return txnId;
    }

    public async Task CommitTransactionAsync(string txnId, CancellationToken ct = default)
    {
        if (!_transactions.TryRemove(txnId, out var entry))
            throw new InvalidOperationException($"Transaction '{txnId}' not found.");
        await entry.Transaction.CommitAsync(ct);
        await entry.Connection.DisposeAsync();
    }

    public async Task RollbackTransactionAsync(string txnId, CancellationToken ct = default)
    {
        if (!_transactions.TryRemove(txnId, out var entry))
            throw new InvalidOperationException($"Transaction '{txnId}' not found.");
        await entry.Transaction.RollbackAsync(ct);
        await entry.Connection.DisposeAsync();
    }

    public async Task<QueryExecutionResult> ExecuteInTransactionAsync(string txnId, string sql, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
    {
        if (!_transactions.TryGetValue(txnId, out var entry))
            throw new InvalidOperationException($"Transaction '{txnId}' not found.");

        var messages = new List<string>();
        entry.Connection.InfoMessage += (_, e) => {
            if (!string.IsNullOrWhiteSpace(e.Message))
                messages.Add(e.Message);
        };

        await using var cmd = new SqlCommand(sql, entry.Connection, entry.Transaction) { CommandTimeout = timeoutSeconds };
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

    public async Task RollbackAllTransactionsAsync()
    {
        foreach (var txnId in _transactions.Keys.ToList())
        {
            if (_transactions.TryRemove(txnId, out var entry))
            {
                try { await entry.Transaction.RollbackAsync(); } catch { }
                try { await entry.Connection.DisposeAsync(); } catch { }
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await RollbackAllTransactionsAsync();
        if (_connection is not null)
        {
            await _connection.DisposeAsync();
            _connection = null;
        }
    }
}

using System.Collections.Concurrent;
using System.Data;
using Oracle.ManagedDataAccess.Client;

namespace DbAnalyser.Providers.Oracle;

public class OracleProvider : IDbProvider
{
    private OracleConnection? _connection;
    private string _connectionString = string.Empty;
    private readonly ConcurrentDictionary<string, (OracleConnection Connection, OracleTransaction Transaction)> _transactions = new();

    public string ConnectionString => _connectionString;
    public string DatabaseName => _connection?.Database ?? string.Empty;
    public string ServerName => _connection?.DataSource ?? string.Empty;

    public async Task ConnectAsync(string connectionString, CancellationToken ct = default)
    {
        _connectionString = connectionString;
        _connection = new OracleConnection(connectionString);
        await _connection.OpenAsync(ct);
    }

    public Task ChangeDatabaseAsync(string databaseName, CancellationToken ct = default)
    {
        // Oracle doesn't support changing databases — schemas are accessed via fully qualified names
        return Task.CompletedTask;
    }

    public async Task<DataTable> ExecuteQueryAsync(string sql, CancellationToken ct = default)
    {
        if (_connection is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");

        await using var cmd = new OracleCommand(sql, _connection);
        cmd.CommandTimeout = 300;
        cmd.InitialLONGFetchSize = -1; // Fetch entire LONG columns (needed for ALL_VIEWS.TEXT etc.)

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var table = new DataTable();
        table.Load(reader);
        return table;
    }

    public async Task<DataTable> ExecuteQueryAsync(string sql, Dictionary<string, object> parameters, CancellationToken ct = default)
    {
        if (_connection is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");

        await using var cmd = new OracleCommand(sql, _connection);
        cmd.CommandTimeout = 300;
        cmd.InitialLONGFetchSize = -1;
        cmd.BindByName = true;
        foreach (var (key, value) in parameters)
            cmd.Parameters.Add(new OracleParameter(key, value));

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var table = new DataTable();
        table.Load(reader);
        return table;
    }

    public async Task<object?> ExecuteScalarAsync(string sql, CancellationToken ct = default)
    {
        if (_connection is null)
            throw new InvalidOperationException("Not connected. Call ConnectAsync first.");

        await using var cmd = new OracleCommand(sql, _connection);
        cmd.CommandTimeout = 300;

        var result = await cmd.ExecuteScalarAsync(ct);
        return result == DBNull.Value ? null : result;
    }

    public Task<List<DataTable>> ExecuteQueryMultipleAsync(string sql, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
        => ExecuteQueryMultipleAsync(sql, _connectionString, maxRows, timeoutSeconds, ct);

    public async Task<List<DataTable>> ExecuteQueryMultipleAsync(string sql, string connectionStringOverride, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
    {
        await using var conn = new OracleConnection(connectionStringOverride);
        await conn.OpenAsync(ct);

        await using var cmd = new OracleCommand(sql, conn);
        cmd.CommandTimeout = timeoutSeconds;

        await using var reader = await cmd.ExecuteReaderAsync(CommandBehavior.KeyInfo, ct);
        var results = await ReaderColumnHelper.ReadResultSetsAsync(reader, maxRows, ct);

        return results;
    }

    public async Task<QueryExecutionResult> ExecuteQueryFullAsync(string sql, string connectionString, int maxRows = 1000, int timeoutSeconds = 30, bool showPlan = false, bool showStats = false, CancellationToken ct = default)
    {
        var messages = new List<string>();

        // Plan mode: EXPLAIN PLAN FOR + DBMS_XPLAN
        if (showPlan)
        {
            try
            {
                await using var planConn = new OracleConnection(connectionString);
                await planConn.OpenAsync(ct);

                await using var explainCmd = new OracleCommand($"EXPLAIN PLAN FOR {sql}", planConn) { CommandTimeout = timeoutSeconds };
                await explainCmd.ExecuteNonQueryAsync(ct);

                await using var planCmd = new OracleCommand("SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY())", planConn) { CommandTimeout = timeoutSeconds };
                await using var planReader = await planCmd.ExecuteReaderAsync(ct);

                var planLines = new List<string>();
                while (await planReader.ReadAsync(ct))
                {
                    if (planReader.FieldCount > 0)
                        planLines.Add(planReader.GetString(0));
                }

                return new QueryExecutionResult([], messages, string.Join("\n", planLines));
            }
            catch (Exception ex)
            {
                messages.Add($"Execution plan failed: {ex.Message}");
                return new QueryExecutionResult([], messages);
            }
        }

        // Normal execution
        await using var conn = new OracleConnection(connectionString);
        await conn.OpenAsync(ct);

        var limitedSql = SqlRowLimiter.ApplyRowLimitForOracle(sql, maxRows);
        await using var cmd = new OracleCommand(limitedSql, conn) { CommandTimeout = timeoutSeconds };
        await using var reader = await cmd.ExecuteReaderAsync(CommandBehavior.KeyInfo, ct);
        var results = await ReaderColumnHelper.ReadResultSetsAsync(reader, maxRows, ct);

        ReaderColumnHelper.AddRecordsAffectedMessage(reader, messages);

        return new QueryExecutionResult(results, messages);
    }

    public async Task<string> BeginTransactionAsync(string connectionString, CancellationToken ct = default)
    {
        var conn = new OracleConnection(connectionString);
        await conn.OpenAsync(ct);
        var txn = conn.BeginTransaction();
        var txnId = Guid.NewGuid().ToString("N")[..12];
        _transactions[txnId] = (conn, txn);
        return txnId;
    }

    public async Task CommitTransactionAsync(string txnId, CancellationToken ct = default)
    {
        if (!_transactions.TryRemove(txnId, out var entry))
            throw new InvalidOperationException($"Transaction '{txnId}' not found.");
        entry.Transaction.Commit();
        await entry.Connection.DisposeAsync();
    }

    public async Task RollbackTransactionAsync(string txnId, CancellationToken ct = default)
    {
        if (!_transactions.TryRemove(txnId, out var entry))
            throw new InvalidOperationException($"Transaction '{txnId}' not found.");
        entry.Transaction.Rollback();
        await entry.Connection.DisposeAsync();
    }

    public async Task<QueryExecutionResult> ExecuteInTransactionAsync(string txnId, string sql, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
    {
        if (!_transactions.TryGetValue(txnId, out var entry))
            throw new InvalidOperationException($"Transaction '{txnId}' not found.");

        var messages = new List<string>();

        await using var cmd = new OracleCommand(sql, entry.Connection) { CommandTimeout = timeoutSeconds };
        await using var reader = await cmd.ExecuteReaderAsync(CommandBehavior.KeyInfo, ct);
        var results = await ReaderColumnHelper.ReadResultSetsAsync(reader, maxRows, ct);

        ReaderColumnHelper.AddRecordsAffectedMessage(reader, messages);

        return new QueryExecutionResult(results, messages);
    }

    public async Task RollbackAllTransactionsAsync()
    {
        foreach (var txnId in _transactions.Keys.ToList())
        {
            if (_transactions.TryRemove(txnId, out var entry))
            {
                try { entry.Transaction.Rollback(); } catch { }
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

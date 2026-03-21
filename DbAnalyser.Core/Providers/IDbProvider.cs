using System.Data;

namespace DbAnalyser.Providers;

public record QueryExecutionResult(List<DataTable> ResultSets, List<string> Messages, string? ExecutionPlan = null);

public interface IDbProvider : IAsyncDisposable
{
    string ConnectionString { get; }
    string DatabaseName { get; }
    string ServerName { get; }
    Task ConnectAsync(string connectionString, CancellationToken ct = default);
    Task ChangeDatabaseAsync(string databaseName, CancellationToken ct = default);
    Task<DataTable> ExecuteQueryAsync(string sql, CancellationToken ct = default);
    Task<object?> ExecuteScalarAsync(string sql, CancellationToken ct = default);

    /// <summary>
    /// Execute a query on a NEW connection (not the analyzer connection) and return multiple result sets.
    /// Each result set is capped at maxRows rows.
    /// </summary>
    Task<List<DataTable>> ExecuteQueryMultipleAsync(string sql, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
    {
        return Task.FromResult(new List<DataTable>());
    }

    /// <summary>
    /// Execute a query on a NEW connection using a specific connection string (e.g. targeting a different database).
    /// </summary>
    Task<List<DataTable>> ExecuteQueryMultipleAsync(string sql, string connectionStringOverride, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
    {
        return ExecuteQueryMultipleAsync(sql, maxRows, timeoutSeconds, ct);
    }

    /// <summary>
    /// Execute a query returning result sets, messages, and optionally an execution plan.
    /// </summary>
    Task<QueryExecutionResult> ExecuteQueryFullAsync(string sql, string connectionString, int maxRows = 1000, int timeoutSeconds = 30, bool showPlan = false, CancellationToken ct = default)
    {
        return Task.FromResult(new QueryExecutionResult([], []));
    }

    /// <summary>Begin a transaction on a new connection and return a transaction ID.</summary>
    Task<string> BeginTransactionAsync(string connectionString, CancellationToken ct = default)
    {
        throw new NotSupportedException("Transactions not supported by this provider.");
    }

    /// <summary>Commit a previously started transaction.</summary>
    Task CommitTransactionAsync(string txnId, CancellationToken ct = default)
    {
        throw new NotSupportedException("Transactions not supported by this provider.");
    }

    /// <summary>Rollback a previously started transaction.</summary>
    Task RollbackTransactionAsync(string txnId, CancellationToken ct = default)
    {
        throw new NotSupportedException("Transactions not supported by this provider.");
    }

    /// <summary>Execute a query within an existing transaction.</summary>
    Task<QueryExecutionResult> ExecuteInTransactionAsync(string txnId, string sql, int maxRows = 1000, int timeoutSeconds = 30, CancellationToken ct = default)
    {
        throw new NotSupportedException("Transactions not supported by this provider.");
    }

    /// <summary>Rollback all open transactions (for cleanup).</summary>
    Task RollbackAllTransactionsAsync()
    {
        return Task.CompletedTask;
    }
}

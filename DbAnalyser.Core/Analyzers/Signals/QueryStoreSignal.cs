using System.Data;
using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public class QueryStoreSignal : IUsageSignal
{
    public string Name => "Query Store";

    public async Task<List<SignalResult>> EvaluateAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct)
    {
        var results = new List<SignalResult>();

        // Check if Query Store is enabled
        var stateRow = await TryQuerySingleRow(provider,
            "SELECT actual_state_desc FROM sys.database_query_store_options", ct);

        if (stateRow is null)
            return results;

        var state = stateRow["actual_state_desc"]?.ToString();
        if (state is not ("READ_WRITE" or "READ_ONLY"))
            return results;

        // 1. Proc/function execution from Query Store (persists across restarts)
        await CollectProcFunctionStats(provider, results, ct);

        // 2. Table references from query texts
        if (result.Schema is not null)
            await CollectTableReferences(provider, result, results, ct);

        return results;
    }

    private static async Task CollectProcFunctionStats(
        IDbProvider provider, List<SignalResult> results, CancellationToken ct)
    {
        // Pre-aggregate at the query level first, then join objects — avoids
        // exploding the row count across all plans × all runtime stat intervals
        const string sql = """
            ;WITH QueryAgg AS (
                SELECT
                    q.object_id,
                    SUM(rs.count_executions) AS TotalExecutions,
                    MAX(rs.last_execution_time) AS LastExecution,
                    MIN(rs.first_execution_time) AS FirstExecution
                FROM sys.query_store_query q
                JOIN sys.query_store_plan p ON q.query_id = p.query_id
                JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
                WHERE q.object_id <> 0
                GROUP BY q.object_id
            )
            SELECT
                SCHEMA_NAME(o.schema_id) AS SchemaName,
                o.name AS ObjectName,
                CASE
                    WHEN o.type IN ('P', 'PC') THEN 'Procedure'
                    WHEN o.type IN ('FN', 'IF', 'TF', 'FS', 'FT') THEN 'Function'
                    ELSE 'Procedure'
                END AS ObjectType,
                a.TotalExecutions,
                a.LastExecution,
                a.FirstExecution
            FROM QueryAgg a
            JOIN sys.objects o ON a.object_id = o.object_id
            """;

        var table = await TryQuery(provider, sql, ct);
        if (table is null) return;

        foreach (DataRow row in table.Rows)
        {
            var schema = row["SchemaName"]?.ToString() ?? "dbo";
            var name = row["ObjectName"]?.ToString() ?? "";
            var objectName = $"{schema}.{name}";
            var objectType = row["ObjectType"]?.ToString() ?? "Procedure";
            var totalExec = Convert.ToInt64(row["TotalExecutions"]);
            var lastExec = row["LastExecution"] is DBNull ? (DateTime?)null : Convert.ToDateTime(row["LastExecution"]);
            var firstExec = row["FirstExecution"] is DBNull ? (DateTime?)null : Convert.ToDateTime(row["FirstExecution"]);

            if (totalExec > 0)
            {
                var span = firstExec.HasValue && lastExec.HasValue
                    ? $" over {(lastExec.Value - firstExec.Value).Days} days"
                    : "";
                results.Add(new SignalResult(objectName, objectType, 1.0,
                    $"Query Store: {totalExec:N0} executions{span}, last at {lastExec?.ToString("yyyy-MM-dd HH:mm") ?? "unknown"}"));
            }
            else
            {
                results.Add(new SignalResult(objectName, objectType, -0.6,
                    "Query Store: no executions recorded"));
            }
        }
    }

    private static async Task CollectTableReferences(
        IDbProvider provider, AnalysisResult result, List<SignalResult> results, CancellationToken ct)
    {
        // Pre-aggregate execution counts per query_text_id (small result set),
        // then join the text and truncate to 4000 chars to limit memory
        const string sql = """
            ;WITH TextAgg AS (
                SELECT TOP 200
                    q.query_text_id,
                    SUM(rs.count_executions) AS TotalExecutions,
                    MAX(rs.last_execution_time) AS LastExecution
                FROM sys.query_store_query q
                JOIN sys.query_store_plan p ON q.query_id = p.query_id
                JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
                WHERE q.object_id = 0
                GROUP BY q.query_text_id
                ORDER BY SUM(rs.count_executions) DESC
            )
            SELECT
                LEFT(qt.query_sql_text, 4000) AS query_sql_text,
                a.TotalExecutions,
                a.LastExecution
            FROM TextAgg a
            JOIN sys.query_store_query_text qt ON a.query_text_id = qt.query_text_id
            """;

        var table = await TryQuery(provider, sql, ct);
        if (table is null || result.Schema is null) return;

        // Build a results accumulator keyed by fullName
        var tableCounts = new Dictionary<string, (long executions, DateTime? lastExec)>(
            StringComparer.OrdinalIgnoreCase);

        // Build search list — just table names, mapped to their full name
        var searchNames = new List<(string search, string fullName)>();
        foreach (var t in result.Schema.Tables)
        {
            searchNames.Add((t.FullName, t.FullName));
            // Only add short name if it's not ambiguous (appears once)
            searchNames.Add((t.TableName, t.FullName));
        }

        // Scan query texts for table name mentions
        foreach (DataRow row in table.Rows)
        {
            var queryText = row["query_sql_text"]?.ToString();
            if (string.IsNullOrEmpty(queryText)) continue;

            var executions = Convert.ToInt64(row["TotalExecutions"]);
            var lastExec = row["LastExecution"] is DBNull ? (DateTime?)null : Convert.ToDateTime(row["LastExecution"]);

            foreach (var (search, fullName) in searchNames)
            {
                if (!ContainsTableReference(queryText, search)) continue;

                if (tableCounts.TryGetValue(fullName, out var current))
                {
                    tableCounts[fullName] = (
                        current.executions + executions,
                        current.lastExec is null || (lastExec.HasValue && lastExec > current.lastExec)
                            ? lastExec : current.lastExec
                    );
                }
                else
                {
                    tableCounts[fullName] = (executions, lastExec);
                }
            }
        }

        // Emit signals
        foreach (var (fullName, (executions, lastExec)) in tableCounts)
        {
            if (executions <= 0) continue;
            results.Add(new SignalResult(fullName, "Table", 0.8,
                $"Query Store: referenced in ad-hoc queries with {executions:N0} total executions, last at {lastExec?.ToString("yyyy-MM-dd HH:mm") ?? "unknown"}"));
        }
    }

    private static bool ContainsTableReference(string queryText, string tableName)
    {
        var idx = queryText.IndexOf(tableName, StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return false;

        // Check that it's not part of a longer identifier
        if (idx > 0)
        {
            var before = queryText[idx - 1];
            if (char.IsLetterOrDigit(before) || before == '_') return false;
        }

        var end = idx + tableName.Length;
        if (end < queryText.Length)
        {
            var after = queryText[end];
            if (char.IsLetterOrDigit(after) || after == '_') return false;
        }

        return true;
    }

    private static async Task<DataTable?> TryQuery(IDbProvider provider, string sql, CancellationToken ct)
    {
        try
        {
            return await provider.ExecuteQueryAsync(sql, ct);
        }
        catch
        {
            return null;
        }
    }

    private static async Task<DataRow?> TryQuerySingleRow(IDbProvider provider, string sql, CancellationToken ct)
    {
        var table = await TryQuery(provider, sql, ct);
        return table is { Rows.Count: > 0 } ? table.Rows[0] : null;
    }
}

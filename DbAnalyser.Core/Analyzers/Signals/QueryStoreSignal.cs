using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public class QueryStoreSignal : IUsageSignal
{
    public string Name => "Query Store";

    public async Task<List<SignalResult>> EvaluateAsync(AnalysisContext context, AnalysisResult result, CancellationToken ct)
    {
        var results = new List<SignalResult>();

        if (!await context.PerformanceQueries.IsQueryStoreEnabledAsync(context.Provider, ct))
            return results;

        // 1. Proc/function execution from Query Store (persists across restarts)
        await CollectProcFunctionStats(context, results, ct);

        // 2. Table references from query texts
        if (result.Schema is not null)
            await CollectTableReferences(context, result, results, ct);

        return results;
    }

    private static async Task CollectProcFunctionStats(
        AnalysisContext context, List<SignalResult> results, CancellationToken ct)
    {
        var rows = await context.PerformanceQueries.GetQueryStoreProcStatsAsync(context.Provider, ct);

        foreach (var row in rows)
        {
            var objectName = $"{row.SchemaName}.{row.ObjectName}";

            if (row.TotalExecutions > 0)
            {
                var span = row.FirstExecution.HasValue && row.LastExecution.HasValue
                    ? $" over {(row.LastExecution.Value - row.FirstExecution.Value).Days} days"
                    : "";
                results.Add(new SignalResult(objectName, row.ObjectType, 1.0,
                    $"Query Store: {row.TotalExecutions:N0} executions{span}, last at {row.LastExecution?.ToString("yyyy-MM-dd HH:mm") ?? "unknown"}"));
            }
            else
            {
                results.Add(new SignalResult(objectName, row.ObjectType, -0.6,
                    "Query Store: no executions recorded"));
            }
        }
    }

    private static async Task CollectTableReferences(
        AnalysisContext context, AnalysisResult result, List<SignalResult> results, CancellationToken ct)
    {
        var rows = await context.PerformanceQueries.GetQueryStoreTopQueriesAsync(context.Provider, 200, ct);
        if (rows.Count == 0 || result.Schema is null) return;

        var tableCounts = new Dictionary<string, (long executions, DateTime? lastExec)>(
            StringComparer.OrdinalIgnoreCase);

        var searchNames = new List<(string search, string fullName)>();
        foreach (var t in result.Schema.Tables)
        {
            searchNames.Add((t.FullName, t.FullName));
            searchNames.Add((t.TableName, t.FullName));
        }

        foreach (var row in rows)
        {
            if (string.IsNullOrEmpty(row.QueryText)) continue;

            foreach (var (search, fullName) in searchNames)
            {
                if (!ContainsTableReference(row.QueryText, search)) continue;

                if (tableCounts.TryGetValue(fullName, out var current))
                {
                    tableCounts[fullName] = (
                        current.executions + row.TotalExecutions,
                        current.lastExec is null || (row.LastExecution.HasValue && row.LastExecution > current.lastExec)
                            ? row.LastExecution : current.lastExec
                    );
                }
                else
                {
                    tableCounts[fullName] = (row.TotalExecutions, row.LastExecution);
                }
            }
        }

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
}

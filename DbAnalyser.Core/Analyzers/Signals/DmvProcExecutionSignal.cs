using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public class DmvProcExecutionSignal : IUsageSignal
{
    public string Name => "DMV Proc Execution";

    public async Task<List<SignalResult>> EvaluateAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct)
    {
        var results = new List<SignalResult>();
        var uptimeDays = result.UsageAnalysis?.ServerUptimeDays ?? 0;

        // Stored procedures
        const string procSql = """
            SELECT
                SCHEMA_NAME(p.schema_id) AS SchemaName,
                p.name AS ProcName,
                ps.execution_count AS ExecutionCount,
                ps.last_execution_time AS LastExecution
            FROM sys.procedures p
            LEFT JOIN sys.dm_exec_procedure_stats ps
                ON p.object_id = ps.object_id AND ps.database_id = DB_ID()
            """;

        var procTable = await provider.ExecuteQueryAsync(procSql, ct);

        foreach (System.Data.DataRow row in procTable.Rows)
        {
            var schema = row["SchemaName"]?.ToString() ?? "dbo";
            var name = row["ProcName"]?.ToString() ?? "";
            var objectName = $"{schema}.{name}";
            var execCount = row["ExecutionCount"] is DBNull ? 0 : Convert.ToInt64(row["ExecutionCount"]);

            if (execCount > 0)
            {
                var lastExec = row["LastExecution"] is DBNull ? null : (DateTime?)Convert.ToDateTime(row["LastExecution"]);
                var lastExecStr = lastExec?.ToString("yyyy-MM-dd HH:mm") ?? "unknown";
                results.Add(new SignalResult(objectName, "Procedure", 1.0,
                    $"Executed {execCount:N0} times, last at {lastExecStr}"));
            }
            else if (uptimeDays >= 30)
            {
                results.Add(new SignalResult(objectName, "Procedure", -0.8,
                    $"Never executed in {uptimeDays} days of uptime"));
            }
        }

        // Functions
        const string funcSql = """
            SELECT
                SCHEMA_NAME(o.schema_id) AS SchemaName,
                o.name AS FuncName,
                fs.execution_count AS ExecutionCount,
                fs.last_execution_time AS LastExecution
            FROM sys.objects o
            LEFT JOIN sys.dm_exec_function_stats fs
                ON o.object_id = fs.object_id AND fs.database_id = DB_ID()
            WHERE o.type IN ('FN', 'IF', 'TF')
            """;

        try
        {
            var funcTable = await provider.ExecuteQueryAsync(funcSql, ct);

            foreach (System.Data.DataRow row in funcTable.Rows)
            {
                var schema = row["SchemaName"]?.ToString() ?? "dbo";
                var name = row["FuncName"]?.ToString() ?? "";
                var objectName = $"{schema}.{name}";
                var execCount = row["ExecutionCount"] is DBNull ? 0 : Convert.ToInt64(row["ExecutionCount"]);

                if (execCount > 0)
                {
                    var lastExec = row["LastExecution"] is DBNull ? null : (DateTime?)Convert.ToDateTime(row["LastExecution"]);
                    var lastExecStr = lastExec?.ToString("yyyy-MM-dd HH:mm") ?? "unknown";
                    results.Add(new SignalResult(objectName, "Function", 1.0,
                        $"Executed {execCount:N0} times, last at {lastExecStr}"));
                }
                else if (uptimeDays >= 30)
                {
                    results.Add(new SignalResult(objectName, "Function", -0.8,
                        $"Never executed in {uptimeDays} days of uptime"));
                }
            }
        }
        catch
        {
            // sys.dm_exec_function_stats not available on older SQL Server versions
        }

        return results;
    }
}

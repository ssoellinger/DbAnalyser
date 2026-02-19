using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public class DmvTableReadsSignal : IUsageSignal
{
    public string Name => "DMV Table Reads";

    public async Task<List<SignalResult>> EvaluateAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct)
    {
        var results = new List<SignalResult>();

        // Determine server uptime
        var uptimeDays = result.UsageAnalysis?.ServerUptimeDays ?? 0;

        const string sql = """
            SELECT
                SCHEMA_NAME(t.schema_id) AS SchemaName,
                t.name AS TableName,
                COALESCE(SUM(s.user_seeks + s.user_scans + s.user_lookups), 0) AS TotalReads,
                COALESCE(SUM(s.user_updates), 0) AS TotalWrites,
                MAX(s.last_user_seek) AS LastSeek,
                MAX(s.last_user_scan) AS LastScan,
                MAX(s.last_user_lookup) AS LastLookup
            FROM sys.tables t
            LEFT JOIN sys.dm_db_index_usage_stats s
                ON t.object_id = s.object_id AND s.database_id = DB_ID()
            GROUP BY t.schema_id, t.name
            """;

        var table = await provider.ExecuteQueryAsync(sql, ct);

        foreach (System.Data.DataRow row in table.Rows)
        {
            var schema = row["SchemaName"]?.ToString() ?? "dbo";
            var name = row["TableName"]?.ToString() ?? "";
            var objectName = $"{schema}.{name}";
            var totalReads = Convert.ToInt64(row["TotalReads"]);
            var totalWrites = Convert.ToInt64(row["TotalWrites"]);

            if (totalReads > 0 && uptimeDays >= 7)
            {
                results.Add(new SignalResult(objectName, "Table", 1.0,
                    $"Table has {totalReads:N0} reads and {totalWrites:N0} writes since server start"));
            }
            else if (totalReads == 0 && totalWrites == 0 && uptimeDays >= 30)
            {
                results.Add(new SignalResult(objectName, "Table", -0.8,
                    $"No reads or writes detected in {uptimeDays} days of uptime"));
            }
            // If uptime < 7 days, don't emit a signal (insufficient data)
        }

        return results;
    }
}

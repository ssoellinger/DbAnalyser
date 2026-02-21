using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public class DmvTableReadsSignal : IUsageSignal
{
    public string Name => "DMV Table Reads";

    public async Task<List<SignalResult>> EvaluateAsync(AnalysisContext context, AnalysisResult result, CancellationToken ct)
    {
        var results = new List<SignalResult>();
        var uptimeDays = result.UsageAnalysis?.ServerUptimeDays ?? 0;

        var rows = await context.PerformanceQueries.GetTableUsageStatsAsync(context.Provider, ct);

        foreach (var row in rows)
        {
            var objectName = $"{row.SchemaName}.{row.TableName}";

            if (row.TotalReads > 0 && uptimeDays >= 7)
            {
                results.Add(new SignalResult(objectName, "Table", 1.0,
                    $"Table has {row.TotalReads:N0} reads and {row.TotalWrites:N0} writes since server start"));
            }
            else if (row.TotalReads == 0 && row.TotalWrites == 0 && uptimeDays >= 30)
            {
                results.Add(new SignalResult(objectName, "Table", -0.8,
                    $"No reads or writes detected in {uptimeDays} days of uptime"));
            }
        }

        return results;
    }
}

using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public class DmvProcExecutionSignal : IUsageSignal
{
    public string Name => "DMV Proc Execution";

    public async Task<List<SignalResult>> EvaluateAsync(AnalysisContext context, AnalysisResult result, CancellationToken ct)
    {
        var results = new List<SignalResult>();
        var uptimeDays = result.UsageAnalysis?.ServerUptimeDays ?? 0;

        // Stored procedures
        var procRows = await context.PerformanceQueries.GetProcExecutionStatsAsync(context.Provider, ct);

        foreach (var row in procRows)
        {
            var objectName = $"{row.SchemaName}.{row.ProcName}";

            if (row.ExecutionCount > 0)
            {
                var lastExecStr = row.LastExecution?.ToString("yyyy-MM-dd HH:mm") ?? "unknown";
                results.Add(new SignalResult(objectName, "Procedure", 1.0,
                    $"Executed {row.ExecutionCount:N0} times, last at {lastExecStr}"));
            }
            else if (uptimeDays >= 30)
            {
                results.Add(new SignalResult(objectName, "Procedure", -0.8,
                    $"Never executed in {uptimeDays} days of uptime"));
            }
        }

        // Functions
        try
        {
            var funcRows = await context.PerformanceQueries.GetFunctionExecutionStatsAsync(context.Provider, ct);

            foreach (var row in funcRows)
            {
                var objectName = $"{row.SchemaName}.{row.FuncName}";

                if (row.ExecutionCount > 0)
                {
                    var lastExecStr = row.LastExecution?.ToString("yyyy-MM-dd HH:mm") ?? "unknown";
                    results.Add(new SignalResult(objectName, "Function", 1.0,
                        $"Executed {row.ExecutionCount:N0} times, last at {lastExecStr}"));
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
            // Function stats not available on older SQL Server versions
        }

        return results;
    }
}

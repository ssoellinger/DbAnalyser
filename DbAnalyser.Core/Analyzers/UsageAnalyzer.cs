using DbAnalyser.Analyzers.Signals;
using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public class UsageAnalyzer : IAnalyzer
{
    public string Name => "usage";

    private readonly List<IUsageSignal> _signals =
    [
        new DmvTableReadsSignal(),
        new DmvProcExecutionSignal(),
        new RowCountSignal(),
        new DependencyOrphanSignal(),
        new NamingPatternSignal(),
    ];

    public async Task AnalyzeAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct = default)
    {
        var analysis = new UsageAnalysis();

        // Query server uptime
        try
        {
            var startTime = await provider.ExecuteScalarAsync(
                "SELECT sqlserver_start_time FROM sys.dm_os_sys_info", ct);

            if (startTime is DateTime st)
            {
                analysis.ServerStartTime = st;
                analysis.ServerUptimeDays = (int)(DateTime.UtcNow - st).TotalDays;
            }
        }
        catch
        {
            // DMV may not be accessible — leave uptime null
        }

        // Attach early so signals can read uptime
        result.UsageAnalysis = analysis;

        // Run all signals and collect results
        var allSignals = new List<SignalResult>();

        foreach (var signal in _signals)
        {
            try
            {
                var signalResults = await signal.EvaluateAsync(provider, result, ct);
                allSignals.AddRange(signalResults);
            }
            catch
            {
                // Individual signal failure shouldn't break the analysis
            }
        }

        // Group by object and compute scores
        var grouped = allSignals.GroupBy(s => $"{s.ObjectName}|{s.ObjectType}",
            StringComparer.OrdinalIgnoreCase);

        foreach (var group in grouped)
        {
            var signals = group.ToList();
            var first = signals[0];
            var avgScore = signals.Average(s => s.Weight);

            var usage = new ObjectUsage
            {
                ObjectName = first.ObjectName,
                ObjectType = first.ObjectType,
                Score = Math.Round(avgScore, 3),
                UsageLevel = MapScoreToLevel(avgScore),
                Evidence = signals.Select(s => s.Evidence).ToList(),
            };

            analysis.Objects.Add(usage);
        }

        // Sort: Unused first, then Low, then Unknown, then Active
        analysis.Objects.Sort((a, b) =>
        {
            var order = LevelOrder(a.UsageLevel).CompareTo(LevelOrder(b.UsageLevel));
            return order != 0 ? order : a.Score.CompareTo(b.Score);
        });
    }

    private static UsageLevel MapScoreToLevel(double score)
    {
        return score switch
        {
            >= 0.3 => UsageLevel.Active,
            >= -0.3 => UsageLevel.Low,
            _ => UsageLevel.Unused,
        };
    }

    private static int LevelOrder(UsageLevel level) => level switch
    {
        UsageLevel.Unused => 0,
        UsageLevel.Low => 1,
        UsageLevel.Unknown => 2,
        UsageLevel.Active => 3,
        _ => 4,
    };
}

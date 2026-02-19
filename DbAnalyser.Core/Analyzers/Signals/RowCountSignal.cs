using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public class RowCountSignal : IUsageSignal
{
    public string Name => "Row Count";

    public Task<List<SignalResult>> EvaluateAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct)
    {
        var results = new List<SignalResult>();

        if (result.Profiles is null)
            return Task.FromResult(results);

        foreach (var profile in result.Profiles)
        {
            if (profile.RowCount == 0)
            {
                results.Add(new SignalResult(profile.FullName, "Table", -0.3,
                    "Table has 0 rows"));
            }
            else
            {
                results.Add(new SignalResult(profile.FullName, "Table", 0.2,
                    $"Table has {profile.RowCount:N0} rows"));
            }
        }

        return Task.FromResult(results);
    }
}

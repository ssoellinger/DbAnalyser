using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public interface IUsageSignal
{
    string Name { get; }
    Task<List<SignalResult>> EvaluateAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct);
}

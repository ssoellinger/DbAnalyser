using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public interface IUsageSignal
{
    string Name { get; }
    Task<List<SignalResult>> EvaluateAsync(AnalysisContext context, AnalysisResult result, CancellationToken ct);
}

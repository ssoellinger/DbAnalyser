using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public interface IAnalyzer
{
    string Name { get; }
    Task AnalyzeAsync(AnalysisContext context, AnalysisResult result, CancellationToken ct = default);
}

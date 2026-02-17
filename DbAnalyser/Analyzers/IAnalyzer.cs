using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public interface IAnalyzer
{
    string Name { get; }
    Task AnalyzeAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct = default);
}

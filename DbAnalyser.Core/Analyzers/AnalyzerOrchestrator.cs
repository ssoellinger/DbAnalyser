using DbAnalyser.Configuration;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public class AnalyzerOrchestrator
{
    private readonly IEnumerable<IAnalyzer> _analyzers;

    public AnalyzerOrchestrator(IEnumerable<IAnalyzer> analyzers)
    {
        _analyzers = analyzers;
    }

    public async Task<AnalysisResult> RunAsync(
        IDbProvider provider,
        AnalysisOptions options,
        CancellationToken ct = default)
    {
        var result = new AnalysisResult
        {
            DatabaseName = provider.DatabaseName,
            AnalyzedAt = DateTime.UtcNow
        };

        var enabledNames = options.Analyzers
            .Select(a => a.ToLowerInvariant())
            .ToHashSet();

        foreach (var analyzer in _analyzers)
        {
            if (!enabledNames.Contains(analyzer.Name.ToLowerInvariant()))
                continue;

            await analyzer.AnalyzeAsync(provider, result, ct);
        }

        return result;
    }
}

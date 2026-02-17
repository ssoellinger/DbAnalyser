using DbAnalyser.Analyzers;

namespace DbAnalyser.Reporting;

public interface IReportGenerator
{
    OutputFormat Format { get; }
    Task GenerateAsync(AnalysisResult result, string? outputPath, CancellationToken ct = default);
}

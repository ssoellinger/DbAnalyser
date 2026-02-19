namespace DbAnalyser.Configuration;

public class AnalysisOptions
{
    public string ConnectionString { get; set; } = string.Empty;
    public string? OutputPath { get; set; }
    public List<string> Analyzers { get; set; } = ["schema", "profiling", "relationships", "quality"];
}

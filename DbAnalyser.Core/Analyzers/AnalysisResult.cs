using DbAnalyser.Models.Profiling;
using DbAnalyser.Models.Quality;
using DbAnalyser.Models.Relationships;
using DbAnalyser.Models.Schema;
using DbAnalyser.Models.Usage;

namespace DbAnalyser.Analyzers;

public class AnalysisResult
{
    public string DatabaseName { get; set; } = string.Empty;
    public DateTime AnalyzedAt { get; set; } = DateTime.UtcNow;
    public DatabaseSchema? Schema { get; set; }
    public List<TableProfile>? Profiles { get; set; }
    public RelationshipMap? Relationships { get; set; }
    public List<QualityIssue>? QualityIssues { get; set; }
    public UsageAnalysis? UsageAnalysis { get; set; }

    // Server-wide analysis
    public bool IsServerMode { get; set; }
    public List<string> Databases { get; set; } = [];
    public List<DatabaseError> FailedDatabases { get; set; } = [];
}

public record DatabaseError(string DatabaseName, string Error);

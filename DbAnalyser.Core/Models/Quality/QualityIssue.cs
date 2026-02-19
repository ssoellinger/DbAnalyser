namespace DbAnalyser.Models.Quality;

public record QualityIssue(
    string Category,
    IssueSeverity Severity,
    string ObjectName,
    string Description,
    string? Recommendation);

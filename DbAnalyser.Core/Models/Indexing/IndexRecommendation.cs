namespace DbAnalyser.Models.Indexing;

public record IndexRecommendation(
    string Category,
    string Severity,
    string SchemaName,
    string TableName,
    string Description,
    string? Recommendation,
    double? ImpactScore,
    string? EqualityColumns,
    string? InequalityColumns,
    string? IncludeColumns,
    string? IndexName,
    long? UserSeeks,
    long? UserScans,
    long? UserLookups,
    long? UserUpdates)
{
    public string? DatabaseName { get; init; }
}

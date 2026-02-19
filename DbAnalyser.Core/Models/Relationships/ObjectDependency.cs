namespace DbAnalyser.Models.Relationships;

public record ObjectDependency(
    string FromSchema,
    string FromName,
    string FromType,
    string ToSchema,
    string ToName,
    string ToType,
    string? ToDatabase = null,
    string? DetectedVia = null)
{
    public bool IsCrossDatabase => ToDatabase is not null;
    public string ToFullName => IsCrossDatabase ? $"{ToDatabase}.{ToSchema}.{ToName}" : $"{ToSchema}.{ToName}";
}

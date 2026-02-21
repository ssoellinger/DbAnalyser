namespace DbAnalyser.Models.Relationships;

public record ObjectDependency(
    string FromSchema,
    string FromName,
    string FromType,
    string ToSchema,
    string ToName,
    string ToType,
    string? ToDatabase = null,
    string? DetectedVia = null,
    string? FromDatabase = null)
{
    public bool IsCrossDatabase => ToDatabase is not null
        && !string.Equals(ToDatabase, FromDatabase, StringComparison.OrdinalIgnoreCase);
    public string ToFullName => ToDatabase is not null
        ? $"{ToDatabase}.{ToSchema}.{ToName}"
        : FromDatabase is not null
            ? $"{FromDatabase}.{ToSchema}.{ToName}"
            : $"{ToSchema}.{ToName}";
    public string FromFullName => FromDatabase is not null
        ? $"{FromDatabase}.{FromSchema}.{FromName}"
        : $"{FromSchema}.{FromName}";
}

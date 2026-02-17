namespace DbAnalyser.Models.Relationships;

public record ImplicitRelationship(
    string FromSchema,
    string FromTable,
    string FromColumn,
    string ToSchema,
    string ToTable,
    string ToColumn,
    double Confidence,
    string Reason);

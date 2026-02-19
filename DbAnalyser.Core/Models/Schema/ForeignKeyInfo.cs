namespace DbAnalyser.Models.Schema;

public record ForeignKeyInfo(
    string Name,
    string FromSchema,
    string FromTable,
    string FromColumn,
    string ToSchema,
    string ToTable,
    string ToColumn,
    string DeleteRule,
    string UpdateRule);

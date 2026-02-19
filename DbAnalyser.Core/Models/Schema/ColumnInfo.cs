namespace DbAnalyser.Models.Schema;

public record ColumnInfo(
    string Name,
    string DataType,
    int? MaxLength,
    int? Precision,
    int? Scale,
    bool IsNullable,
    bool IsPrimaryKey,
    bool IsIdentity,
    bool IsComputed,
    string? DefaultValue,
    int OrdinalPosition);

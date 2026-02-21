namespace DbAnalyser.Models.Schema;

public record UserDefinedTypeInfo(
    string SchemaName,
    string TypeName,
    string BaseType,
    bool IsTableType,
    bool IsNullable,
    int? MaxLength)
{
    public string? DatabaseName { get; init; }
    public string FullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{TypeName}"
        : $"{SchemaName}.{TypeName}";
}

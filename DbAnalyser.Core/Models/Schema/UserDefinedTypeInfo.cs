namespace DbAnalyser.Models.Schema;

public record UserDefinedTypeInfo(
    string SchemaName,
    string TypeName,
    string BaseType,
    bool IsTableType,
    bool IsNullable,
    int? MaxLength)
{
    public string FullName => $"{SchemaName}.{TypeName}";
}

namespace DbAnalyser.Models.Schema;

public record FunctionInfo(
    string SchemaName,
    string FunctionName,
    string FunctionType,
    string Definition,
    DateTime? LastModified)
{
    public string? DatabaseName { get; init; }
    public string FullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{FunctionName}"
        : $"{SchemaName}.{FunctionName}";
}

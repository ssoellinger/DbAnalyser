namespace DbAnalyser.Models.Schema;

public record FunctionInfo(
    string SchemaName,
    string FunctionName,
    string FunctionType,
    string Definition,
    DateTime? LastModified)
{
    public string FullName => $"{SchemaName}.{FunctionName}";
}

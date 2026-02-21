namespace DbAnalyser.Models.Schema;

public record StoredProcedureInfo(
    string SchemaName,
    string ProcedureName,
    string Definition,
    DateTime? LastModified)
{
    public string? DatabaseName { get; init; }
    public string FullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{ProcedureName}"
        : $"{SchemaName}.{ProcedureName}";
}

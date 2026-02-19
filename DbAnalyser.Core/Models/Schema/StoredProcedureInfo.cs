namespace DbAnalyser.Models.Schema;

public record StoredProcedureInfo(
    string SchemaName,
    string ProcedureName,
    string Definition,
    DateTime? LastModified)
{
    public string FullName => $"{SchemaName}.{ProcedureName}";
}

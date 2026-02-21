namespace DbAnalyser.Models.Schema;

public record ViewInfo(
    string SchemaName,
    string ViewName,
    string Definition,
    List<ColumnInfo> Columns)
{
    public string? DatabaseName { get; init; }
    public string FullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{ViewName}"
        : $"{SchemaName}.{ViewName}";
}

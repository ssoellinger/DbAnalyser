namespace DbAnalyser.Models.Schema;

public record ViewInfo(
    string SchemaName,
    string ViewName,
    string Definition,
    List<ColumnInfo> Columns)
{
    public string FullName => $"{SchemaName}.{ViewName}";
}

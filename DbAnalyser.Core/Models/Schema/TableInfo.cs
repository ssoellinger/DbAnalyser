namespace DbAnalyser.Models.Schema;

public record TableInfo(
    string SchemaName,
    string TableName,
    List<ColumnInfo> Columns,
    List<IndexInfo> Indexes,
    List<ForeignKeyInfo> ForeignKeys)
{
    public string? DatabaseName { get; init; }
    public string FullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{TableName}"
        : $"{SchemaName}.{TableName}";
}

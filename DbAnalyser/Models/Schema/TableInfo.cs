namespace DbAnalyser.Models.Schema;

public record TableInfo(
    string SchemaName,
    string TableName,
    List<ColumnInfo> Columns,
    List<IndexInfo> Indexes,
    List<ForeignKeyInfo> ForeignKeys)
{
    public string FullName => $"{SchemaName}.{TableName}";
}

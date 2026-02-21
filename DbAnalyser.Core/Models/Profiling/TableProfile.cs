namespace DbAnalyser.Models.Profiling;

public class TableProfile
{
    public string SchemaName { get; set; } = string.Empty;
    public string TableName { get; set; } = string.Empty;
    public string? DatabaseName { get; set; }
    public long RowCount { get; set; }
    public List<ColumnProfile> ColumnProfiles { get; set; } = [];
    public string FullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{TableName}"
        : $"{SchemaName}.{TableName}";
}

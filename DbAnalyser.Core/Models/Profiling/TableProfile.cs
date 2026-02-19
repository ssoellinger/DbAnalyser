namespace DbAnalyser.Models.Profiling;

public class TableProfile
{
    public string SchemaName { get; set; } = string.Empty;
    public string TableName { get; set; } = string.Empty;
    public long RowCount { get; set; }
    public List<ColumnProfile> ColumnProfiles { get; set; } = [];
    public string FullName => $"{SchemaName}.{TableName}";
}

namespace DbAnalyser.Models.Schema;

public class DatabaseSchema
{
    public string DatabaseName { get; set; } = string.Empty;
    public List<TableInfo> Tables { get; set; } = [];
    public List<ViewInfo> Views { get; set; } = [];
    public List<StoredProcedureInfo> StoredProcedures { get; set; } = [];
}

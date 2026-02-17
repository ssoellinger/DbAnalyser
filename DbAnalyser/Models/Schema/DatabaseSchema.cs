namespace DbAnalyser.Models.Schema;

public class DatabaseSchema
{
    public string DatabaseName { get; set; } = string.Empty;
    public List<TableInfo> Tables { get; set; } = [];
    public List<ViewInfo> Views { get; set; } = [];
    public List<StoredProcedureInfo> StoredProcedures { get; set; } = [];
    public List<FunctionInfo> Functions { get; set; } = [];
    public List<TriggerInfo> Triggers { get; set; } = [];
    public List<SynonymInfo> Synonyms { get; set; } = [];
    public List<SequenceInfo> Sequences { get; set; } = [];
    public List<UserDefinedTypeInfo> UserDefinedTypes { get; set; } = [];
    public List<JobInfo> Jobs { get; set; } = [];
}

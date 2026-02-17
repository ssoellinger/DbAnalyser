namespace DbAnalyser.Models.Schema;

public record TriggerInfo(
    string SchemaName,
    string TriggerName,
    string ParentTable,
    string TriggerType,
    string TriggerEvents,
    bool IsEnabled,
    string Definition)
{
    public string FullName => $"{SchemaName}.{TriggerName}";
    public string ParentFullName => $"{SchemaName}.{ParentTable}";
}

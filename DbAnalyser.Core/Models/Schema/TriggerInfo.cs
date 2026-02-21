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
    public string? DatabaseName { get; init; }
    public string FullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{TriggerName}"
        : $"{SchemaName}.{TriggerName}";
    public string ParentFullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{ParentTable}"
        : $"{SchemaName}.{ParentTable}";
}

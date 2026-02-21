namespace DbAnalyser.Models.Schema;

public record SequenceInfo(
    string SchemaName,
    string SequenceName,
    string DataType,
    long CurrentValue,
    long Increment,
    long MinValue,
    long MaxValue,
    bool IsCycling)
{
    public string? DatabaseName { get; init; }
    public string FullName => DatabaseName is not null
        ? $"{DatabaseName}.{SchemaName}.{SequenceName}"
        : $"{SchemaName}.{SequenceName}";
}

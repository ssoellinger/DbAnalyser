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
    public string FullName => $"{SchemaName}.{SequenceName}";
}

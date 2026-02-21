namespace DbAnalyser.Models.Indexing;

public record IndexInventoryItem(
    string SchemaName,
    string TableName,
    string IndexName,
    string IndexType,
    bool IsUnique,
    bool IsClustered,
    string Columns,
    long UserSeeks,
    long UserScans,
    long UserLookups,
    long UserUpdates,
    long SizeKB)
{
    public string? DatabaseName { get; init; }
}

namespace DbAnalyser.Models.Schema;

public record IndexInfo(
    string Name,
    string Type,
    bool IsUnique,
    bool IsClustered,
    List<string> Columns);

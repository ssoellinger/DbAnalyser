namespace DbAnalyser.Models.Profiling;

public class ColumnProfile
{
    public string ColumnName { get; set; } = string.Empty;
    public string DataType { get; set; } = string.Empty;
    public long TotalCount { get; set; }
    public long NullCount { get; set; }
    public long DistinctCount { get; set; }
    public string? MinValue { get; set; }
    public string? MaxValue { get; set; }
    public double NullPercentage => TotalCount == 0 ? 0 : (double)NullCount / TotalCount * 100;
}

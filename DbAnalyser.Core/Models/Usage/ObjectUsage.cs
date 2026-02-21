namespace DbAnalyser.Models.Usage;

public class ObjectUsage
{
    public string ObjectName { get; set; } = string.Empty;
    public string ObjectType { get; set; } = string.Empty;
    public string? DatabaseName { get; set; }
    public UsageLevel UsageLevel { get; set; } = UsageLevel.Unknown;
    public double Score { get; set; }
    public List<string> Evidence { get; set; } = [];
}

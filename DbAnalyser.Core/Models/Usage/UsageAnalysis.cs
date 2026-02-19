namespace DbAnalyser.Models.Usage;

public class UsageAnalysis
{
    public DateTime? ServerStartTime { get; set; }
    public int? ServerUptimeDays { get; set; }
    public List<ObjectUsage> Objects { get; set; } = [];
}

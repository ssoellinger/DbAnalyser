namespace DbAnalyser.Models.Usage;

public record SignalResult(
    string ObjectName,
    string ObjectType,
    double Weight,
    string Evidence);

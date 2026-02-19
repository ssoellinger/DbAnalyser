namespace DbAnalyser.Models.Schema;

public record JobInfo(
    string JobName,
    string Description,
    bool IsEnabled,
    List<JobStepInfo> Steps,
    DateTime? LastRunDate,
    string? ScheduleDescription);

public record JobStepInfo(
    int StepId,
    string StepName,
    string SubsystemType,
    string? DatabaseName,
    string Command);

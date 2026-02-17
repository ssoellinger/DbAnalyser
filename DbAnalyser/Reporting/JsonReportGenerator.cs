using System.Text.Json;
using System.Text.Json.Serialization;
using DbAnalyser.Analyzers;

namespace DbAnalyser.Reporting;

public class JsonReportGenerator : IReportGenerator
{
    public OutputFormat Format => OutputFormat.Json;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public async Task GenerateAsync(AnalysisResult result, string? outputPath, CancellationToken ct = default)
    {
        var json = JsonSerializer.Serialize(result, JsonOptions);

        if (string.IsNullOrEmpty(outputPath))
        {
            Console.WriteLine(json);
        }
        else
        {
            await File.WriteAllTextAsync(outputPath, json, ct);
            Console.WriteLine($"JSON report written to: {outputPath}");
        }
    }
}

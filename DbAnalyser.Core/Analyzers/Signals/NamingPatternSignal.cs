using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public class NamingPatternSignal : IUsageSignal
{
    public string Name => "Naming Pattern";

    private static readonly string[] SuspiciousPrefixes =
        ["tmp", "temp", "bak", "backup", "old", "test", "_", "zz"];

    private static readonly string[] SuspiciousContains =
        ["deprecated", "archive"];

    public Task<List<SignalResult>> EvaluateAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct)
    {
        var results = new List<SignalResult>();

        if (result.Schema is null)
            return Task.FromResult(results);

        void CheckName(string objectName, string simpleName, string objectType)
        {
            var lower = simpleName.ToLowerInvariant();

            foreach (var prefix in SuspiciousPrefixes)
            {
                if (lower.StartsWith(prefix, StringComparison.Ordinal))
                {
                    results.Add(new SignalResult(objectName, objectType, -0.4,
                        $"Name starts with '{prefix}' — may be temporary or deprecated"));
                    return;
                }
            }

            foreach (var pattern in SuspiciousContains)
            {
                if (lower.Contains(pattern, StringComparison.Ordinal))
                {
                    results.Add(new SignalResult(objectName, objectType, -0.4,
                        $"Name contains '{pattern}' — may be deprecated or archived"));
                    return;
                }
            }
        }

        foreach (var table in result.Schema.Tables)
            CheckName(table.FullName, table.TableName, "Table");

        foreach (var view in result.Schema.Views)
            CheckName(view.FullName, view.ViewName, "View");

        foreach (var proc in result.Schema.StoredProcedures)
            CheckName(proc.FullName, proc.ProcedureName, "Procedure");

        foreach (var func in result.Schema.Functions)
            CheckName(func.FullName, func.FunctionName, "Function");

        return Task.FromResult(results);
    }
}

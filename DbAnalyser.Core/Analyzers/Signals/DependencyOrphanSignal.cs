using DbAnalyser.Models.Usage;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers.Signals;

public class DependencyOrphanSignal : IUsageSignal
{
    public string Name => "Dependency Orphan";

    public Task<List<SignalResult>> EvaluateAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct)
    {
        var results = new List<SignalResult>();

        if (result.Schema is null)
            return Task.FromResult(results);

        // Build sets of referenced objects from FKs
        var fkTargets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var fkSources = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var table in result.Schema.Tables)
        {
            foreach (var fk in table.ForeignKeys)
            {
                fkTargets.Add($"{fk.ToSchema}.{fk.ToTable}");
                fkSources.Add($"{fk.FromSchema}.{fk.FromTable}");
            }
        }

        // Build set of objects referenced via view/proc dependencies
        var depTargets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var depSources = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (result.Relationships?.ViewDependencies is not null)
        {
            foreach (var dep in result.Relationships.ViewDependencies)
            {
                depTargets.Add($"{dep.ToSchema}.{dep.ToName}");
                depSources.Add($"{dep.FromSchema}.{dep.FromName}");
            }
        }

        // Check tables
        foreach (var table in result.Schema.Tables)
        {
            var fullName = table.FullName;
            var isReferencedByFk = fkTargets.Contains(fullName);
            var hasFks = fkSources.Contains(fullName);
            var isDepTarget = depTargets.Contains(fullName);
            var isDepSource = depSources.Contains(fullName);

            var refCount = (isReferencedByFk ? 1 : 0) + (hasFks ? 1 : 0) + (isDepTarget ? 1 : 0) + (isDepSource ? 1 : 0);

            if (refCount == 0)
            {
                results.Add(new SignalResult(fullName, "Table", -0.5,
                    "Not referenced by any FK, view, or procedure"));
            }
            else if (refCount >= 2)
            {
                results.Add(new SignalResult(fullName, "Table", 0.3,
                    $"Referenced by {refCount} relationship types"));
            }
        }

        // Check views
        foreach (var view in result.Schema.Views)
        {
            var fullName = view.FullName;
            var isReferenced = depTargets.Contains(fullName);

            if (!isReferenced)
            {
                results.Add(new SignalResult(fullName, "View", -0.5,
                    "View is not referenced by any other object"));
            }
            else
            {
                results.Add(new SignalResult(fullName, "View", 0.3,
                    "View is referenced by other objects"));
            }
        }

        // Check procs
        foreach (var proc in result.Schema.StoredProcedures)
        {
            var fullName = proc.FullName;
            var isReferenced = depTargets.Contains(fullName);

            if (!isReferenced)
            {
                results.Add(new SignalResult(fullName, "Procedure", -0.5,
                    "Procedure is not referenced by any other database object"));
            }
        }

        // Check functions
        foreach (var func in result.Schema.Functions)
        {
            var fullName = func.FullName;
            var isReferenced = depTargets.Contains(fullName);

            if (!isReferenced)
            {
                results.Add(new SignalResult(fullName, "Function", -0.5,
                    "Function is not referenced by any other database object"));
            }
        }

        return Task.FromResult(results);
    }
}

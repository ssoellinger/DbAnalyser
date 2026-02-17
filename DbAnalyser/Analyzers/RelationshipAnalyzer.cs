using DbAnalyser.Models.Relationships;
using DbAnalyser.Models.Schema;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public class RelationshipAnalyzer : IAnalyzer
{
    public string Name => "relationships";

    public Task AnalyzeAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct = default)
    {
        if (result.Schema is null)
            throw new InvalidOperationException("Schema analysis must run before relationship analysis.");

        var map = new RelationshipMap();

        // Collect all explicit FKs
        foreach (var table in result.Schema.Tables)
        {
            map.ExplicitRelationships.AddRange(table.ForeignKeys);
        }

        // Detect implicit relationships by naming convention
        map.ImplicitRelationships = DetectImplicitRelationships(result.Schema.Tables, map.ExplicitRelationships);

        // Build dependency graph
        map.Dependencies = BuildDependencyGraph(result.Schema.Tables, map.ExplicitRelationships);

        result.Relationships = map;
        return Task.CompletedTask;
    }

    private List<ImplicitRelationship> DetectImplicitRelationships(
        List<TableInfo> tables,
        List<ForeignKeyInfo> explicitFks)
    {
        var implicit_ = new List<ImplicitRelationship>();

        // Build lookup of table names to their PK columns
        var tablePkLookup = new Dictionary<string, (string Schema, string Table, string PkColumn)>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var table in tables)
        {
            var pk = table.Columns.FirstOrDefault(c => c.IsPrimaryKey);
            if (pk is not null)
            {
                tablePkLookup[table.TableName] = (table.SchemaName, table.TableName, pk.Name);
            }
        }

        // Build set of existing FK relationships for deduplication
        var existingFks = explicitFks
            .Select(fk => $"{fk.FromSchema}.{fk.FromTable}.{fk.FromColumn}->{fk.ToSchema}.{fk.ToTable}.{fk.ToColumn}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var table in tables)
        {
            foreach (var column in table.Columns)
            {
                if (column.IsPrimaryKey) continue;

                var match = TryMatchColumnToTable(column.Name, tablePkLookup);
                if (match is null) continue;

                var key = $"{table.SchemaName}.{table.TableName}.{column.Name}->{match.Value.Schema}.{match.Value.Table}.{match.Value.PkColumn}";
                if (existingFks.Contains(key)) continue;

                // Don't suggest self-references through naming convention
                if (string.Equals(table.TableName, match.Value.Table, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(column.Name, match.Value.PkColumn, StringComparison.OrdinalIgnoreCase))
                    continue;

                implicit_.Add(new ImplicitRelationship(
                    FromSchema: table.SchemaName,
                    FromTable: table.TableName,
                    FromColumn: column.Name,
                    ToSchema: match.Value.Schema,
                    ToTable: match.Value.Table,
                    ToColumn: match.Value.PkColumn,
                    Confidence: match.Value.Confidence,
                    Reason: match.Value.Reason));
            }
        }

        return implicit_;
    }

    private (string Schema, string Table, string PkColumn, double Confidence, string Reason)?
        TryMatchColumnToTable(
            string columnName,
            Dictionary<string, (string Schema, string Table, string PkColumn)> tablePkLookup)
    {
        // Pattern 1: Column named "TableNameId" or "TableName_Id"
        foreach (var (tableName, info) in tablePkLookup)
        {
            if (string.Equals(columnName, $"{tableName}Id", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(columnName, $"{tableName}_Id", StringComparison.OrdinalIgnoreCase))
            {
                return (info.Schema, info.Table, info.PkColumn, 0.9,
                    $"Column name '{columnName}' matches pattern '{{TableName}}Id'");
            }

            // Pattern 2: Singular form match (e.g., column "CategoryId" -> table "Categories")
            if (tableName.EndsWith("s", StringComparison.OrdinalIgnoreCase))
            {
                var singular = tableName[..^1];
                if (string.Equals(columnName, $"{singular}Id", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(columnName, $"{singular}_Id", StringComparison.OrdinalIgnoreCase))
                {
                    return (info.Schema, info.Table, info.PkColumn, 0.8,
                        $"Column name '{columnName}' matches singular form of table '{tableName}'");
                }
            }
        }

        // Pattern 3: Column named "FK_Something" or ending in "_fk"
        if (columnName.StartsWith("FK_", StringComparison.OrdinalIgnoreCase))
        {
            var remainder = columnName[3..];
            if (tablePkLookup.TryGetValue(remainder, out var info))
            {
                return (info.Schema, info.Table, info.PkColumn, 0.7,
                    $"Column name '{columnName}' has FK_ prefix matching table '{remainder}'");
            }
        }

        return null;
    }

    private List<TableDependency> BuildDependencyGraph(
        List<TableInfo> tables,
        List<ForeignKeyInfo> fks)
    {
        var deps = new Dictionary<string, TableDependency>(StringComparer.OrdinalIgnoreCase);

        // Initialize all tables
        foreach (var table in tables)
        {
            deps[table.FullName] = new TableDependency
            {
                SchemaName = table.SchemaName,
                TableName = table.TableName
            };
        }

        // Build direct relationships from FKs
        foreach (var fk in fks)
        {
            var from = $"{fk.FromSchema}.{fk.FromTable}";
            var to = $"{fk.ToSchema}.{fk.ToTable}";

            if (deps.TryGetValue(from, out var fromDep) && !fromDep.DependsOn.Contains(to, StringComparer.OrdinalIgnoreCase))
                fromDep.DependsOn.Add(to);

            if (deps.TryGetValue(to, out var toDep) && !toDep.ReferencedBy.Contains(from, StringComparer.OrdinalIgnoreCase))
                toDep.ReferencedBy.Add(from);
        }

        // Compute transitive impact (BFS: all tables reachable via ReferencedBy chains)
        foreach (var dep in deps.Values)
        {
            dep.TransitiveImpact = ComputeTransitiveImpact(dep.FullName, deps);
        }

        return deps.Values
            .OrderByDescending(d => d.ImportanceScore)
            .ToList();
    }

    private List<string> ComputeTransitiveImpact(
        string tableName,
        Dictionary<string, TableDependency> deps)
    {
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<string>();

        // Seed with direct dependents
        if (deps.TryGetValue(tableName, out var root))
        {
            foreach (var child in root.ReferencedBy)
                queue.Enqueue(child);
        }

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!visited.Add(current)) continue;

            if (deps.TryGetValue(current, out var dep))
            {
                foreach (var child in dep.ReferencedBy)
                {
                    if (!visited.Contains(child))
                        queue.Enqueue(child);
                }
            }
        }

        return visited.Order().ToList();
    }
}

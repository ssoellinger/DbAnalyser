using DbAnalyser.Models.Indexing;
using DbAnalyser.Models.Schema;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public class IndexingAnalyzer : IAnalyzer
{
    public string Name => "indexing";

    public async Task AnalyzeAsync(AnalysisContext context, AnalysisResult result, CancellationToken ct = default)
    {
        if (result.Schema is null)
            throw new InvalidOperationException("Schema analysis must run before indexing analysis.");

        var recommendations = new List<IndexRecommendation>();

        var inventory = await context.PerformanceQueries.GetIndexInventoryAsync(context.Provider, ct);
        result.IndexInventory = inventory;

        // Detect unused from the inventory (non-clustered, non-unique, zero reads, has writes)
        foreach (var idx in inventory)
        {
            if (!idx.IsClustered && !idx.IsUnique
                && idx.UserSeeks == 0 && idx.UserScans == 0 && idx.UserLookups == 0
                && idx.UserUpdates > 0)
            {
                recommendations.Add(new IndexRecommendation(
                    Category: "Unused",
                    Severity: "warning",
                    SchemaName: idx.SchemaName,
                    TableName: idx.TableName,
                    Description: $"Index [{idx.IndexName}] on [{idx.SchemaName}].[{idx.TableName}] has zero reads but {idx.UserUpdates:N0} write operations.",
                    Recommendation: $"DROP INDEX [{idx.IndexName}] ON [{idx.SchemaName}].[{idx.TableName}]",
                    ImpactScore: null,
                    EqualityColumns: null,
                    InequalityColumns: null,
                    IncludeColumns: null,
                    IndexName: idx.IndexName,
                    UserSeeks: 0,
                    UserScans: 0,
                    UserLookups: 0,
                    UserUpdates: idx.UserUpdates));
            }
        }

        await FindMissingIndexes(context, recommendations, ct);
        FindDuplicateIndexes(result.Schema.Tables, recommendations);

        result.IndexRecommendations = recommendations;
    }

    private static async Task FindMissingIndexes(AnalysisContext context, List<IndexRecommendation> recommendations, CancellationToken ct)
    {
        var missingRows = await context.PerformanceQueries.GetMissingIndexesAsync(context.Provider, ct);

        foreach (var row in missingRows)
        {
            var impact = row.ImpactScore;
            var severity = impact switch
            {
                > 10000 => "error",
                > 1000 => "warning",
                _ => "info"
            };

            var indexCols = string.Join(", ", new[] { row.EqualityColumns, row.InequalityColumns }
                .Where(c => !string.IsNullOrWhiteSpace(c)));
            var createSql = $"CREATE NONCLUSTERED INDEX [IX_{row.TableName}_{Guid.NewGuid().ToString("N")[..6]}] ON [{row.SchemaName}].[{row.TableName}] ({indexCols})";
            if (!string.IsNullOrWhiteSpace(row.IncludeColumns))
                createSql += $" INCLUDE ({row.IncludeColumns})";

            recommendations.Add(new IndexRecommendation(
                Category: "Missing",
                Severity: severity,
                SchemaName: row.SchemaName,
                TableName: row.TableName,
                Description: $"Missing index on [{row.SchemaName}].[{row.TableName}] — equality: [{row.EqualityColumns ?? "none"}], inequality: [{row.InequalityColumns ?? "none"}]",
                Recommendation: createSql,
                ImpactScore: Math.Round(impact, 2),
                EqualityColumns: row.EqualityColumns,
                InequalityColumns: row.InequalityColumns,
                IncludeColumns: row.IncludeColumns,
                IndexName: null,
                UserSeeks: row.UserSeeks,
                UserScans: row.UserScans,
                UserLookups: null,
                UserUpdates: null));
        }
    }

    private static void FindDuplicateIndexes(List<TableInfo> tables, List<IndexRecommendation> recommendations)
    {
        foreach (var table in tables)
        {
            var indexes = table.Indexes
                .Where(i => !i.IsClustered && i.Columns.Count > 0)
                .ToList();

            for (var i = 0; i < indexes.Count; i++)
            {
                for (var j = i + 1; j < indexes.Count; j++)
                {
                    var a = indexes[i];
                    var b = indexes[j];

                    var shorter = a.Columns.Count <= b.Columns.Count ? a : b;
                    var longer = a.Columns.Count <= b.Columns.Count ? b : a;

                    var isPrefix = shorter.Columns
                        .Select((col, idx) => string.Equals(col, longer.Columns[idx], StringComparison.OrdinalIgnoreCase))
                        .All(match => match);

                    if (isPrefix)
                    {
                        recommendations.Add(new IndexRecommendation(
                            Category: "Duplicate",
                            Severity: "info",
                            SchemaName: table.SchemaName,
                            TableName: table.TableName,
                            Description: $"Index [{shorter.Name}] columns ({string.Join(", ", shorter.Columns)}) are a prefix of [{longer.Name}] ({string.Join(", ", longer.Columns)}).",
                            Recommendation: $"Consider dropping [{shorter.Name}] if [{longer.Name}] covers the same queries.",
                            ImpactScore: null,
                            EqualityColumns: null,
                            InequalityColumns: null,
                            IncludeColumns: null,
                            IndexName: shorter.Name,
                            UserSeeks: null,
                            UserScans: null,
                            UserLookups: null,
                            UserUpdates: null));
                    }
                }
            }
        }
    }
}

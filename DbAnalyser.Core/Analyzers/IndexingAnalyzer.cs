using DbAnalyser.Models.Indexing;
using DbAnalyser.Models.Schema;
using DbAnalyser.Providers;

namespace DbAnalyser.Analyzers;

public class IndexingAnalyzer : IAnalyzer
{
    public string Name => "indexing";

    public async Task AnalyzeAsync(IDbProvider provider, AnalysisResult result, CancellationToken ct = default)
    {
        if (result.Schema is null)
            throw new InvalidOperationException("Schema analysis must run before indexing analysis.");

        var recommendations = new List<IndexRecommendation>();

        // Always set results — even if queries fail, so status transitions to 'loaded'
        var inventory = await QueryIndexInventory(provider, ct);
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

        await FindMissingIndexes(provider, recommendations, ct);
        FindDuplicateIndexes(result.Schema.Tables, recommendations);

        result.IndexRecommendations = recommendations;
    }

    private static async Task<List<IndexInventoryItem>> QueryIndexInventory(IDbProvider provider, CancellationToken ct)
    {
        // Single query: catalog views + DMV LEFT JOINs (pre-aggregated for speed)
        const string fullSql = """
            SELECT
                s.name AS SchemaName,
                t.name AS TableName,
                i.name AS IndexName,
                i.type_desc AS IndexType,
                i.is_unique AS IsUnique,
                CASE WHEN i.type = 1 THEN 1 ELSE 0 END AS IsClustered,
                STUFF((
                    SELECT ', ' + c.name
                    FROM sys.index_columns ic
                    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                    WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                    ORDER BY ic.key_ordinal
                    FOR XML PATH('')
                ), 1, 2, '') AS Columns,
                ISNULL(us.user_seeks, 0) AS UserSeeks,
                ISNULL(us.user_scans, 0) AS UserScans,
                ISNULL(us.user_lookups, 0) AS UserLookups,
                ISNULL(us.user_updates, 0) AS UserUpdates,
                ISNULL(ps.SizeKB, 0) AS SizeKB
            FROM sys.indexes i
            INNER JOIN sys.tables t ON i.object_id = t.object_id
            INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
            LEFT JOIN sys.dm_db_index_usage_stats us
                ON i.object_id = us.object_id AND i.index_id = us.index_id AND us.database_id = DB_ID()
            LEFT JOIN (
                SELECT object_id, index_id, SUM(used_page_count) * 8 AS SizeKB
                FROM sys.dm_db_partition_stats
                GROUP BY object_id, index_id
            ) ps ON i.object_id = ps.object_id AND i.index_id = ps.index_id
            WHERE i.name IS NOT NULL
              AND t.is_ms_shipped = 0
            ORDER BY s.name, t.name, i.index_id
            """;

        // Fallback: catalog views only (no DMVs at all)
        const string fallbackSql = """
            SELECT
                s.name AS SchemaName,
                t.name AS TableName,
                i.name AS IndexName,
                i.type_desc AS IndexType,
                i.is_unique AS IsUnique,
                CASE WHEN i.type = 1 THEN 1 ELSE 0 END AS IsClustered,
                STUFF((
                    SELECT ', ' + c.name
                    FROM sys.index_columns ic
                    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                    WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                    ORDER BY ic.key_ordinal
                    FOR XML PATH('')
                ), 1, 2, '') AS Columns
            FROM sys.indexes i
            INNER JOIN sys.tables t ON i.object_id = t.object_id
            INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE i.name IS NOT NULL
              AND t.is_ms_shipped = 0
            ORDER BY s.name, t.name, i.index_id
            """;

        var items = new List<IndexInventoryItem>();

        try
        {
            var dt = await provider.ExecuteQueryAsync(fullSql, ct);
            foreach (System.Data.DataRow row in dt.Rows)
            {
                items.Add(new IndexInventoryItem(
                    SchemaName: row["SchemaName"]?.ToString() ?? "dbo",
                    TableName: row["TableName"]?.ToString() ?? "",
                    IndexName: row["IndexName"]?.ToString() ?? "",
                    IndexType: row["IndexType"]?.ToString() ?? "",
                    IsUnique: Convert.ToBoolean(row["IsUnique"]),
                    IsClustered: Convert.ToBoolean(row["IsClustered"]),
                    Columns: row["Columns"]?.ToString() ?? "",
                    UserSeeks: Convert.ToInt64(row["UserSeeks"]),
                    UserScans: Convert.ToInt64(row["UserScans"]),
                    UserLookups: Convert.ToInt64(row["UserLookups"]),
                    UserUpdates: Convert.ToInt64(row["UserUpdates"]),
                    SizeKB: Convert.ToInt64(row["SizeKB"])));
            }
            return items;
        }
        catch
        {
            // DMV access failed — try catalog-only
        }

        try
        {
            var dt = await provider.ExecuteQueryAsync(fallbackSql, ct);
            foreach (System.Data.DataRow row in dt.Rows)
            {
                items.Add(new IndexInventoryItem(
                    SchemaName: row["SchemaName"]?.ToString() ?? "dbo",
                    TableName: row["TableName"]?.ToString() ?? "",
                    IndexName: row["IndexName"]?.ToString() ?? "",
                    IndexType: row["IndexType"]?.ToString() ?? "",
                    IsUnique: Convert.ToBoolean(row["IsUnique"]),
                    IsClustered: Convert.ToBoolean(row["IsClustered"]),
                    Columns: row["Columns"]?.ToString() ?? "",
                    UserSeeks: 0,
                    UserScans: 0,
                    UserLookups: 0,
                    UserUpdates: 0,
                    SizeKB: 0));
            }
        }
        catch
        {
            // Both queries failed — return empty inventory
        }

        return items;
    }

    private static async Task FindMissingIndexes(IDbProvider provider, List<IndexRecommendation> recommendations, CancellationToken ct)
    {
        const string sql = """
            SELECT
                d.statement AS TableName,
                OBJECT_SCHEMA_NAME(d.object_id) AS SchemaName,
                s.avg_total_user_cost * s.avg_user_impact * (s.user_seeks + s.user_scans) AS ImpactScore,
                d.equality_columns AS EqualityColumns,
                d.inequality_columns AS InequalityColumns,
                d.included_columns AS IncludeColumns,
                s.user_seeks AS UserSeeks,
                s.user_scans AS UserScans
            FROM sys.dm_db_missing_index_details d
            INNER JOIN sys.dm_db_missing_index_groups g ON d.index_handle = g.index_handle
            INNER JOIN sys.dm_db_missing_index_group_stats s ON g.index_group_handle = s.group_handle
            WHERE d.database_id = DB_ID()
            ORDER BY ImpactScore DESC
            """;

        try
        {
            var dt = await provider.ExecuteQueryAsync(sql, ct);

            foreach (System.Data.DataRow row in dt.Rows)
            {
                var schemaName = row["SchemaName"]?.ToString() ?? "dbo";
                var rawTable = row["TableName"]?.ToString() ?? "";
                var tableName = rawTable.Split('.').Last().Trim('[', ']');
                var impact = Convert.ToDouble(row["ImpactScore"]);
                var eqCols = row["EqualityColumns"]?.ToString();
                var ineqCols = row["InequalityColumns"]?.ToString();
                var inclCols = row["IncludeColumns"]?.ToString();

                var severity = impact switch
                {
                    > 10000 => "error",
                    > 1000 => "warning",
                    _ => "info"
                };

                var indexCols = string.Join(", ", new[] { eqCols, ineqCols }
                    .Where(c => !string.IsNullOrWhiteSpace(c)));
                var createSql = $"CREATE NONCLUSTERED INDEX [IX_{tableName}_{Guid.NewGuid().ToString("N")[..6]}] ON [{schemaName}].[{tableName}] ({indexCols})";
                if (!string.IsNullOrWhiteSpace(inclCols))
                    createSql += $" INCLUDE ({inclCols})";

                recommendations.Add(new IndexRecommendation(
                    Category: "Missing",
                    Severity: severity,
                    SchemaName: schemaName,
                    TableName: tableName,
                    Description: $"Missing index on [{schemaName}].[{tableName}] — equality: [{eqCols ?? "none"}], inequality: [{ineqCols ?? "none"}]",
                    Recommendation: createSql,
                    ImpactScore: Math.Round(impact, 2),
                    EqualityColumns: eqCols,
                    InequalityColumns: ineqCols,
                    IncludeColumns: inclCols,
                    IndexName: null,
                    UserSeeks: row["UserSeeks"] is DBNull ? null : Convert.ToInt64(row["UserSeeks"]),
                    UserScans: row["UserScans"] is DBNull ? null : Convert.ToInt64(row["UserScans"]),
                    UserLookups: null,
                    UserUpdates: null));
            }
        }
        catch
        {
            // DMV may not be accessible
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

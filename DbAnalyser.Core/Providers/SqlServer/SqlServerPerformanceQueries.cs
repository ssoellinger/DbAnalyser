using System.Data;
using DbAnalyser.Models.Indexing;

namespace DbAnalyser.Providers.SqlServer;

public class SqlServerPerformanceQueries : IPerformanceQueries
{
    public async Task<List<IndexInventoryItem>> GetIndexInventoryAsync(IDbProvider provider, CancellationToken ct)
    {
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
            foreach (DataRow row in dt.Rows)
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
            foreach (DataRow row in dt.Rows)
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

    public async Task<List<MissingIndexRow>> GetMissingIndexesAsync(IDbProvider provider, CancellationToken ct)
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
            return dt.Rows.Cast<DataRow>().Select(row =>
            {
                var rawTable = row["TableName"]?.ToString() ?? "";
                var tableName = rawTable.Split('.').Last().Trim('[', ']');
                return new MissingIndexRow(
                    SchemaName: row["SchemaName"]?.ToString() ?? "dbo",
                    TableName: tableName,
                    ImpactScore: Convert.ToDouble(row["ImpactScore"]),
                    EqualityColumns: row["EqualityColumns"]?.ToString(),
                    InequalityColumns: row["InequalityColumns"]?.ToString(),
                    IncludeColumns: row["IncludeColumns"]?.ToString(),
                    UserSeeks: row["UserSeeks"] is DBNull ? null : Convert.ToInt64(row["UserSeeks"]),
                    UserScans: row["UserScans"] is DBNull ? null : Convert.ToInt64(row["UserScans"]));
            }).ToList();
        }
        catch
        {
            return [];
        }
    }

    public async Task<List<TableUsageRow>> GetTableUsageStatsAsync(IDbProvider provider, CancellationToken ct)
    {
        const string sql = """
            SELECT
                SCHEMA_NAME(t.schema_id) AS SchemaName,
                t.name AS TableName,
                COALESCE(SUM(s.user_seeks + s.user_scans + s.user_lookups), 0) AS TotalReads,
                COALESCE(SUM(s.user_updates), 0) AS TotalWrites,
                MAX(s.last_user_seek) AS LastSeek,
                MAX(s.last_user_scan) AS LastScan,
                MAX(s.last_user_lookup) AS LastLookup
            FROM sys.tables t
            LEFT JOIN sys.dm_db_index_usage_stats s
                ON t.object_id = s.object_id AND s.database_id = DB_ID()
            GROUP BY t.schema_id, t.name
            """;

        var table = await provider.ExecuteQueryAsync(sql, ct);
        return table.Rows.Cast<DataRow>().Select(r => new TableUsageRow(
            SchemaName: r["SchemaName"]?.ToString() ?? "dbo",
            TableName: r["TableName"]?.ToString() ?? "",
            TotalReads: Convert.ToInt64(r["TotalReads"]),
            TotalWrites: Convert.ToInt64(r["TotalWrites"]),
            LastSeek: r["LastSeek"] is DBNull ? null : Convert.ToDateTime(r["LastSeek"]),
            LastScan: r["LastScan"] is DBNull ? null : Convert.ToDateTime(r["LastScan"]),
            LastLookup: r["LastLookup"] is DBNull ? null : Convert.ToDateTime(r["LastLookup"])
        )).ToList();
    }

    public async Task<List<ProcUsageRow>> GetProcExecutionStatsAsync(IDbProvider provider, CancellationToken ct)
    {
        const string sql = """
            SELECT
                SCHEMA_NAME(p.schema_id) AS SchemaName,
                p.name AS ProcName,
                ps.execution_count AS ExecutionCount,
                ps.last_execution_time AS LastExecution
            FROM sys.procedures p
            LEFT JOIN sys.dm_exec_procedure_stats ps
                ON p.object_id = ps.object_id AND ps.database_id = DB_ID()
            """;

        var table = await provider.ExecuteQueryAsync(sql, ct);
        return table.Rows.Cast<DataRow>().Select(r => new ProcUsageRow(
            SchemaName: r["SchemaName"]?.ToString() ?? "dbo",
            ProcName: r["ProcName"]?.ToString() ?? "",
            ExecutionCount: r["ExecutionCount"] is DBNull ? 0 : Convert.ToInt64(r["ExecutionCount"]),
            LastExecution: r["LastExecution"] is DBNull ? null : Convert.ToDateTime(r["LastExecution"])
        )).ToList();
    }

    public async Task<List<FuncUsageRow>> GetFunctionExecutionStatsAsync(IDbProvider provider, CancellationToken ct)
    {
        const string sql = """
            SELECT
                SCHEMA_NAME(o.schema_id) AS SchemaName,
                o.name AS FuncName,
                fs.execution_count AS ExecutionCount,
                fs.last_execution_time AS LastExecution
            FROM sys.objects o
            LEFT JOIN sys.dm_exec_function_stats fs
                ON o.object_id = fs.object_id AND fs.database_id = DB_ID()
            WHERE o.type IN ('FN', 'IF', 'TF')
            """;

        try
        {
            var table = await provider.ExecuteQueryAsync(sql, ct);
            return table.Rows.Cast<DataRow>().Select(r => new FuncUsageRow(
                SchemaName: r["SchemaName"]?.ToString() ?? "dbo",
                FuncName: r["FuncName"]?.ToString() ?? "",
                ExecutionCount: r["ExecutionCount"] is DBNull ? 0 : Convert.ToInt64(r["ExecutionCount"]),
                LastExecution: r["LastExecution"] is DBNull ? null : Convert.ToDateTime(r["LastExecution"])
            )).ToList();
        }
        catch
        {
            // sys.dm_exec_function_stats not available on older SQL Server versions
            return [];
        }
    }

    public async Task<bool> IsQueryStoreEnabledAsync(IDbProvider provider, CancellationToken ct)
    {
        try
        {
            var dt = await provider.ExecuteQueryAsync(
                "SELECT actual_state_desc FROM sys.database_query_store_options", ct);

            if (dt.Rows.Count == 0) return false;
            var state = dt.Rows[0]["actual_state_desc"]?.ToString();
            return state is "READ_WRITE" or "READ_ONLY";
        }
        catch
        {
            return false;
        }
    }

    public async Task<List<QsProcRow>> GetQueryStoreProcStatsAsync(IDbProvider provider, CancellationToken ct)
    {
        const string sql = """
            ;WITH QueryAgg AS (
                SELECT
                    q.object_id,
                    SUM(rs.count_executions) AS TotalExecutions,
                    MAX(rs.last_execution_time) AS LastExecution,
                    MIN(rs.first_execution_time) AS FirstExecution
                FROM sys.query_store_query q
                JOIN sys.query_store_plan p ON q.query_id = p.query_id
                JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
                WHERE q.object_id <> 0
                GROUP BY q.object_id
            )
            SELECT
                SCHEMA_NAME(o.schema_id) AS SchemaName,
                o.name AS ObjectName,
                CASE
                    WHEN o.type IN ('P', 'PC') THEN 'Procedure'
                    WHEN o.type IN ('FN', 'IF', 'TF', 'FS', 'FT') THEN 'Function'
                    ELSE 'Procedure'
                END AS ObjectType,
                a.TotalExecutions,
                a.LastExecution,
                a.FirstExecution
            FROM QueryAgg a
            JOIN sys.objects o ON a.object_id = o.object_id
            """;

        try
        {
            var dt = await provider.ExecuteQueryAsync(sql, ct);
            return dt.Rows.Cast<DataRow>().Select(r => new QsProcRow(
                SchemaName: r["SchemaName"]?.ToString() ?? "dbo",
                ObjectName: r["ObjectName"]?.ToString() ?? "",
                ObjectType: r["ObjectType"]?.ToString() ?? "Procedure",
                TotalExecutions: Convert.ToInt64(r["TotalExecutions"]),
                LastExecution: r["LastExecution"] is DBNull ? null : Convert.ToDateTime(r["LastExecution"]),
                FirstExecution: r["FirstExecution"] is DBNull ? null : Convert.ToDateTime(r["FirstExecution"])
            )).ToList();
        }
        catch
        {
            return [];
        }
    }

    public async Task<List<QsTextRow>> GetQueryStoreTopQueriesAsync(IDbProvider provider, int topN, CancellationToken ct)
    {
        var sql = $"""
            ;WITH TextAgg AS (
                SELECT TOP {topN}
                    q.query_text_id,
                    SUM(rs.count_executions) AS TotalExecutions,
                    MAX(rs.last_execution_time) AS LastExecution
                FROM sys.query_store_query q
                JOIN sys.query_store_plan p ON q.query_id = p.query_id
                JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
                WHERE q.object_id = 0
                GROUP BY q.query_text_id
                ORDER BY SUM(rs.count_executions) DESC
            )
            SELECT
                LEFT(qt.query_sql_text, 4000) AS query_sql_text,
                a.TotalExecutions,
                a.LastExecution
            FROM TextAgg a
            JOIN sys.query_store_query_text qt ON a.query_text_id = qt.query_text_id
            """;

        try
        {
            var dt = await provider.ExecuteQueryAsync(sql, ct);
            return dt.Rows.Cast<DataRow>().Select(r => new QsTextRow(
                QueryText: r["query_sql_text"]?.ToString() ?? "",
                TotalExecutions: Convert.ToInt64(r["TotalExecutions"]),
                LastExecution: r["LastExecution"] is DBNull ? null : Convert.ToDateTime(r["LastExecution"])
            )).ToList();
        }
        catch
        {
            return [];
        }
    }
}
